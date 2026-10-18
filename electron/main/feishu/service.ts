import { LiveReply, boundedCardText, type ReplyCard } from './cards'
import type { AgentEventEnvelope } from '../../../src/types/api'
import { FeishuConversationError, FeishuConversations, IMAGE_BASELINE, textDigest, type ConversationHarness } from './conversations'
import { FeishuBinding } from './binding'
import { createHash } from 'node:crypto'
import type { FeishuStatus } from '../../../src/types/feishu'
import { assertNoMcpAuthenticationCommand } from '../../../src/lib/mcp-policy'
import type { HarnessRuntimeMap } from '../harness-runtime'
import { requireRecord, rejectUnknownKeys, requireString } from '../validation'
import { admittedMessage, parseCommand, parseConfig, type FeishuMessage } from './protocol'
import { imageDigest, prepareSessionImage, type SessionImage } from './image'
import type { FeishuRecord, FeishuStore } from './store'
import { createFeishuTransport, type FeishuTransport } from './transport'

const HELP = 'PTX 飞书会话\n直接发文字或图片即可继续当前会话，电脑端同步可见。\n/新建：开始新会话\n/会话：列出当前项目会话\n/切换 会话ID：切换会话\n/状态：查看当前会话\n/结果：查看最新回复\n/发图 图片路径：把电脑上的本地图片发到本聊天\n/停止：停止当前会话并清除引擎队列\n电脑需保持运行，交互确认请在电脑处理。'
type Projects = Pick<HarnessRuntimeMap['pi']['projects'], 'list' | 'authorizeCwd'>
// Desktop prompts and their settled messages arrive as these events; images are scanned only then, not on every token.
const IMAGE_SCAN_EVENTS = new Set<string>(['agent_start', 'message_start', 'message_end', 'agent_end'])
const IMAGE_RETRY_MS = 10_000
const ECHO_PREFIX = 'echo:'
const FEISHU_IMAGE_BYTES = 10 * 1024 * 1024


export class FeishuService {
  readonly binding = new FeishuBinding()

  async finishBinding(raw: unknown): Promise<FeishuStatus> {
    const target = requireRecord(raw, 'binding target')
    rejectUnknownKeys(target, ['harness', 'projectId', 'model'])
    const credentials = this.binding.requireCredentials()
    const saved = await this.save({ ...target, appId: credentials.appId, allowedOpenId: credentials.openId }, credentials.secret)
    this.binding.cancel()
    return saved
  }

  private record: FeishuRecord | null = null
  private transport: FeishuTransport | null = null
  private error?: string
  private timer?: ReturnType<typeof setInterval>
  private handling = false
  private pending = 0
  private tail: Promise<void> = Promise.resolve()
  private configuring = false
  private generation = 0
  private imagesDirty = false
  private imageRetryAt = 0

  private live?: { sessionFile: string; reply: LiveReply }
  private syncedRevision = -1
  private conversations: FeishuConversations

  constructor(private store: FeishuStore, harnesses: Record<'pi' | 'omp', ConversationHarness>, private projects: Record<'pi' | 'omp', Projects>,
    private makeTransport: (appId: string, secret: string) => FeishuTransport = createFeishuTransport) {
    this.conversations = new FeishuConversations(harnesses)
    try { this.record = store.load() }
    catch { this.error = '飞书配置无法读取，请检查系统安全存储。原文件已保留。' }
  }

  onAgentEvent({ runtimeId, event }: AgentEventEnvelope): void {
    const record = this.record
    const binding = record?.conversation
    if (!record?.enabled || !binding || !this.transport || !this.conversations.ownsRuntime(record.config, binding, runtimeId)) return
    if (typeof event.type === 'string' && IMAGE_SCAN_EVENTS.has(event.type)) this.imagesDirty = true
    if (!this.live || this.live.sessionFile !== binding.sessionFile || (event.type === 'agent_start' && this.live.reply.finalizing)) {
      this.live = { sessionFile: binding.sessionFile, reply: new LiveReply() }
      this.syncedRevision = -1
    }
    this.live.reply.apply(event)
  }

  status(): FeishuStatus {
    return { config: this.record ? { ...this.record.config } : null, hasSecret: Boolean(this.record?.secret), enabled: this.record?.enabled ?? false,
      connection: this.transport?.state() ?? 'idle', ...(this.error ? { error: this.error } : {}) }
  }

  private persist(next: FeishuRecord): void { this.store.save(next); this.record = next }

  private async exclusive(work: () => Promise<void>): Promise<FeishuStatus> {
    if (this.configuring || this.handling || this.pending) throw new Error('正在处理飞书请求，请稍后重试。')
    this.configuring = true
    try { await work(); return this.status() } finally { this.configuring = false }
  }

  async save(raw: unknown, rawSecret: unknown): Promise<FeishuStatus> {
    return this.exclusive(async () => {
      const config = parseConfig(raw)
      const entered = requireString(rawSecret, 'App Secret', { max: 512, trim: true })
      const secret = entered || (this.record?.config.appId === config.appId ? this.record.secret : '')
      if (!secret) throw new TypeError('请输入 App Secret')
      await this.project(config)
      if (this.activeConversation()) throw new Error('请先停止或完成当前手机会话，再修改配置。')
      this.stop()
      this.persist({ config, secret, enabled: false, seen: this.record?.seen ?? [], task: null,
        ...(this.record?.conversation && JSON.stringify(config) === JSON.stringify(this.record.config) ? { conversation: this.record.conversation } : {}) })
      this.error = undefined
    })
  }

  async connect(): Promise<FeishuStatus> {
    return this.exclusive(async () => {
      if (!this.record) throw new Error('请先保存飞书配置。')
      await this.project(this.record.config)
      this.persist({ ...this.record, enabled: true })
      await this.start()
    })
  }

  async disconnect(): Promise<FeishuStatus> {
    return this.exclusive(async () => {
      if (this.record) this.persist({ ...this.record, enabled: false })
      this.stop()
    })
  }

  async forget(): Promise<FeishuStatus> {
    return this.exclusive(async () => {
      if (this.activeConversation()) throw new Error('请先停止或完成当前手机会话。')
      this.stop()
      this.store.forget()
      this.record = null
      this.error = undefined
    })
  }

  async start(): Promise<void> {
    this.stop()
    const record = this.record
    if (!record?.enabled) return
    const generation = this.generation
    const transport = this.makeTransport(record.config.appId, record.secret)
    this.transport = transport
    this.imagesDirty = true
    this.error = undefined
    // Keep startup non-blocking; the SDK owns reconnect attempts.
    void transport.start(async (raw) => {
      if (generation !== this.generation || this.configuring) return
      const message = admittedMessage(raw, record.config.allowedOpenId)
      if (!message) return
      if (!message || this.record?.seen.some((receipt) => receipt.id === message.id)) return
      if (this.pending >= 32) { this.error = '飞书消息过于频繁，请稍后重试。'; return }
      this.pending++
      const previous = this.tail
      const work = previous.then(async () => {
        if (generation !== this.generation || this.record?.seen.some((receipt) => receipt.id === message.id)) return
        this.handling = true
        try { await this.receive(message, transport, generation) }
        catch (error) {
          this.error = error instanceof FeishuConversationError ? error.message : '飞书请求处理失败，请在桌面检查项目授权和手机配置。'
          if (generation === this.generation) await this.reply(transport, message, this.error).catch(() => undefined)
        } finally { this.handling = false }
      }).finally(() => { this.pending-- })
      this.tail = work.catch(() => undefined)
      await work
    }).catch(() => { if (generation === this.generation) this.error = '飞书连接失败，请检查 App ID、App Secret、长连接设置和网络。' })
    this.timer = setInterval(() => {
      if (this.handling || this.pending || this.configuring) return
      // The receive chain waits on this tail; a rejection here would silently drop
      // incoming phone messages, so keep the same guard the receive path uses.
      this.tail = this.tick(transport, generation).catch(() => undefined)
    }, 1_000)
    this.timer.unref()
  }

  stop(): void {
    this.generation++
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.transport?.close()
    this.transport = null
    this.live = undefined
    this.syncedRevision = -1
  }

  private async project(config: FeishuRecord['config']) {
    const service = this.projects[config.harness]
    const project = (await service.list()).find((item) => item.id === config.projectId && item.harness === config.harness && !item.inferred && !item.readOnly)
    if (!project) throw new FeishuConversationError('项目授权已失效，请在桌面重新选择并授权所选引擎的项目。')
    return { ...project, primaryFolder: await service.authorizeCwd(project.primaryFolder) }
  }

  private activeConversation(): boolean {
    return Boolean(this.record?.conversation && this.conversations.busy(this.record.config, this.record.conversation))
  }

  private async reply(transport: FeishuTransport, message: FeishuMessage, text: string) {
    await transport.send(message.chatId, text, createHash('sha256').update(message.id).digest('hex').slice(0, 32))
  }

  private async receive(message: FeishuMessage, transport: FeishuTransport, generation: number): Promise<void> {
    if (!this.record) return
    const seen = this.record.seen.filter((receipt) => Date.now() - receipt.at < 6 * 60_000)
    if (seen.length >= 1000) throw new Error('Message receipt capacity reached')
    this.persist({ ...this.record, seen: [...seen, { id: message.id, at: Date.now() }] })
    if (message.imageKey) { await this.receiveImage(message, transport, generation); return }
    const command = parseCommand(message.text)
    if (command.kind === 'help') { await this.reply(transport, message, HELP); return }
    if (command.kind === 'sendImage') {
      if (!command.path) { await this.reply(transport, message, '用法：/发图 图片绝对路径，例如 /发图 /tmp/ptx-window.png'); return }
      if (!/\.(png|jpe?g|webp|gif)$/i.test(command.path)) { await this.reply(transport, message, '仅支持 png / jpg / jpeg / webp / gif 图片。'); return }
      try {
        await transport.sendImage(message.chatId, command.path, createHash('sha256').update(`${message.id}:image`).digest('hex').slice(0, 32))
        await this.reply(transport, message, '图片已发送。')
      } catch (error) {
        const reason = error instanceof Error && error.message ? error.message : '图片发送失败。'
        this.error = reason
        await this.reply(transport, message, reason).catch(() => undefined)
      }
      return
    }
    const config = this.record.config
    const project = await this.project(config)
    if (generation !== this.generation) return
    if (command.kind === 'sessions') {
      const sessions = (await this.conversations.list(config)).slice(0, 20)
      await this.reply(transport, message, sessions.length ? sessions.map((session) => `${session.title}\n/切换 ${session.id}`).join('\n\n') : '暂无会话，直接发消息即可创建。')
      return
    }
    if (command.kind === 'new' || command.kind === 'switch') {
      if (this.activeConversation()) { await this.reply(transport, message, '当前会话仍在运行，请等待完成或先 /停止 再切换。'); return }
      if (this.record.conversation) {
        await this.notify(transport, generation, true)
        if (this.record.conversation?.card) {
          await this.reply(transport, message, '上一张回复卡片尚未完成同步，请检查卡片权限和网络后再切换。')
          return
        }
      }
      if (command.kind === 'new') {
        const conversation = await this.conversations.create(config, project.primaryFolder, message.chatId)
        this.persist({ ...this.record, conversation })
      } else if (command.kind === 'switch') {
        const id = command.id
        const session = (await this.conversations.list(config)).find((item) => item.id === id)
        if (!session) { await this.reply(transport, message, '找不到此项目中的会话，请发送 /会话 获取完整 ID。'); return }
        const conversation = { sessionFile: session.filePath, sessionId: session.id, chatId: message.chatId, title: session.title, delivered: [] }
        const { replies, texts, images } = await this.conversations.transcript(config, conversation)
        const delivered = [...replies.map((item) => item.id), ...texts.map((item) => item.key), ...images.map((item) => item.key), IMAGE_BASELINE].slice(-2000)
        this.persist({ ...this.record, conversation: { ...conversation, delivered } })
      }
      await this.reply(transport, message, '已切换会话。直接发送文字即可继续，电脑端可查看同一会话。')
      return
    }
    if (command.kind === 'message') {
      assertNoMcpAuthenticationCommand(command.prompt, config.harness)
      if (!this.record.conversation) {
        const conversation = await this.conversations.create(config, project.primaryFolder, message.chatId)
        this.persist({ ...this.record, conversation })
      }
      const binding = this.record.conversation
      if (!binding || generation !== this.generation) return
      if (binding.chatId !== message.chatId) throw new Error('会话聊天身份不一致')
      const busy = this.conversations.busy(config, binding)
      await this.conversations.send(config, binding, command.prompt)
      this.recordEcho(`text:${textDigest(command.prompt)}`)
      try { await this.reply(transport, message, busy ? '已加入当前会话队列。' : '已发送到当前会话，回复会同步到这里。') }
      catch { this.error = '消息已提交，但飞书回执失败。请通过 /状态 查询，勿重复提交。' }
      return
    }
    const binding = this.record.conversation
    if (!binding) { await this.reply(transport, message, '暂无绑定会话，直接发消息开始，或发送 /会话 选择已有会话。'); return }
    if (binding.chatId !== message.chatId) throw new Error('会话聊天身份不一致')
    await this.conversations.require(config, binding)
    if (command.kind === 'stop') {
      await this.conversations.stop(config, binding)
      await this.reply(transport, message, '当前会话已停止。后续发消息将恢复此会话，已有上下文保留。')
    } else if (command.kind === 'result') {
      const result = (await this.conversations.replies(config, binding)).at(-1)
      await this.reply(transport, message, result?.text ?? '暂时没有助手文字回复。')
    } else await this.reply(transport, message, `会话：${binding.title}\nID：${binding.sessionId}\n项目：${project.name}\n引擎：${config.harness}\n状态：${this.conversations.busy(config, binding) ? '运行中或等待确认' : '空闲'}`)
  }

  private async receiveImage(message: FeishuMessage, transport: FeishuTransport, generation: number): Promise<void> {
    if (!this.record || !message.imageKey) return
    const config = this.record.config
    if (!this.record.conversation) {
      const project = await this.project(config)
      const conversation = await this.conversations.create(config, project.primaryFolder, message.chatId)
      this.persist({ ...this.record, conversation })
    }
    if (generation !== this.generation) return
    const binding = this.record.conversation
    if (!binding) return
    if (binding.chatId !== message.chatId) throw new Error('会话聊天身份不一致')
    await this.conversations.require(config, binding)
    let image: SessionImage | { error: string }
    try {
      image = prepareSessionImage(await transport.downloadImage(message.id, message.imageKey))
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : '图片下载失败。'
      await this.reply(transport, message, reason).catch(() => undefined)
      return
    }
    if ('error' in image) { await this.reply(transport, message, image.error); return }
    const queued = this.conversations.busy(config, binding)
    await this.conversations.send(config, binding, message.text || '[图片]', [image])
    this.recordEcho(imageDigest(image.data))
    if (message.text) this.recordEcho(`text:${textDigest(message.text)}`)
    try { await this.reply(transport, message, queued ? '图片已加入当前会话队列。' : '图片已发送到当前会话。') }
    catch { this.error = '图片已提交，但飞书回执失败。请通过 /状态 查询，勿重复提交。' }
  }

  private updateDelivered(change: (delivered: string[]) => string[]): void {
    const conversation = this.record?.conversation
    if (!this.record || !conversation) return
    this.persist({ ...this.record, conversation: { ...conversation, delivered: change(conversation.delivered).slice(-2000) } })
  }

  /** Phone-originated images echo back through the transcript; one echo marker suppresses exactly one such image. */
  private recordEcho(digest: string): void {
    this.updateDelivered((delivered) => [...delivered, `${ECHO_PREFIX}${digest}`])
  }

  private async tick(transport: FeishuTransport, generation: number): Promise<void> {
    if (this.imagesDirty && Date.now() >= this.imageRetryAt) await this.syncDesktop(transport, generation)
    await this.notify(transport, generation)
  }

  private async syncDesktop(transport: FeishuTransport, generation: number): Promise<void> {
    if (generation !== this.generation || !this.record?.conversation || transport.state() !== 'connected') return
    this.imagesDirty = false
    this.handling = true
    try {
      const config = this.record.config
      const { texts, images } = await this.conversations.transcript(config, this.record.conversation)
      if (!this.record.conversation.delivered.includes(IMAGE_BASELINE)) {
        this.updateDelivered((delivered) => [...delivered.filter((item) => !item.startsWith(ECHO_PREFIX)), ...texts.map((item) => item.key), ...images.map((item) => item.key), IMAGE_BASELINE])
        return
      }
      // Receipt-cap eviction can drop old keys, so anchor each scan at the newest
      // already-delivered item of its kind; earlier entries were accounted for and
      // must never be reconsidered.
      const settledKeys = new Set(this.record.conversation.delivered)
      const anchor = (items: readonly { key: string }[]) => {
        for (let i = items.length - 1; i >= 0; i--) if (settledKeys.has(items[i].key)) return i
        return -1
      }
      for (const item of texts.slice(anchor(texts) + 1)) {
        const conversation = this.record?.conversation
        if (!conversation || generation !== this.generation) return
        if (conversation.delivered.includes(item.key)) continue
        if (this.consumeEcho(`${ECHO_PREFIX}text:${item.digest}`, item.key)) continue
        const uuid = createHash('sha256').update(`${conversation.sessionId}:${item.key}`).digest('hex').slice(0, 32)
        await transport.send(conversation.chatId, boundedCardText(item.text), uuid)
        this.updateDelivered((delivered) => [...delivered, item.key])
      }
      for (const item of images.slice(anchor(images) + 1)) {
        const conversation = this.record?.conversation
        if (!conversation || generation !== this.generation) return
        if (conversation.delivered.includes(item.key)) continue
        if (item.digest && this.consumeEcho(`${ECHO_PREFIX}${item.digest}`, item.key)) continue
        const uuid = createHash('sha256').update(`${conversation.sessionId}:${item.key}`).digest('hex').slice(0, 32)
        const bytes = item.data ? Buffer.from(item.data, 'base64') : undefined
        if (!bytes || bytes.length > FEISHU_IMAGE_BYTES) {
          // Send the notice before recording the receipt so a failed notice is retried
          // instead of being silently dropped.
          await transport.send(conversation.chatId, '电脑端图片过大，无法同步到飞书，请在电脑查看。', createHash('sha256').update(`${uuid}:notice`).digest('hex').slice(0, 32))
          this.updateDelivered((delivered) => [...delivered, item.key])
          continue
        }
        await transport.sendImageData(conversation.chatId, bytes, uuid)
        this.updateDelivered((delivered) => [...delivered, item.key])
      }
    } catch (error) {
      console.warn('[feishu] desktop sync failed, retrying:', error instanceof Error ? error.message : error)
      this.imagesDirty = true
      this.imageRetryAt = Date.now() + IMAGE_RETRY_MS
    } finally {
      this.handling = false
    }
  }

  /** Consumes one phone-originated echo marker for this desktop item; returns true when the item must not be forwarded. */
  private consumeEcho(echo: string, key: string): boolean {
    const delivered = this.record?.conversation?.delivered ?? []
    if (!delivered.includes(echo)) return false
    this.updateDelivered((items) => {
      const index = items.indexOf(echo)
      return [...items.slice(0, index), ...items.slice(index + 1), key]
    })
    return true
  }

  private async notify(transport: FeishuTransport, generation: number, admitted = false): Promise<void> {
    if ((!admitted && (this.handling || this.pending || this.configuring)) || generation !== this.generation || !this.record?.conversation || transport.state() !== 'connected') return
    const wasHandling = this.handling
    this.handling = true
    let stage: 'project' | 'transcript' | 'send' | 'receipt' = 'project'
    try {
      const binding = this.record.conversation
      await this.project(this.record.config)
      stage = 'transcript'
      await this.conversations.require(this.record.config, binding)
      const busy = this.conversations.busy(this.record.config, binding)
      const live = this.live?.sessionFile === binding.sessionFile ? this.live.reply : undefined
      const finishing = binding.card?.finishing === true
      if (busy && !live && !finishing) return
      stage = 'transcript'
      const replies = busy && !finishing ? [] : await this.conversations.replies(this.record.config, binding)
      // Delivered receipts interleave reply ids with text/image keys, so the list can end
      // with a non-reply id. Anchor on the newest delivered reply: items before it were
      // already accounted for and must never be reconsidered, even after receipt-cap
      // eviction trims their ids.
      const replyOrder = new Map(replies.map((item, index) => [item.id, index]))
      let cursor = -1
      for (let i = binding.delivered.length - 1; i >= 0; i--) {
        const found = replyOrder.get(binding.delivered[i])
        if (found !== undefined) { cursor = found; break }
      }
      const unseen = replies.slice(cursor + 1).filter((item) => !binding.delivered.includes(item.id))
      const done = !busy || finishing
      const revision = live?.revision ?? -1
      if (binding.card || unseen.length || (live && revision > 0)) {
        const snapshot: ReplyCard = done && unseen.length
          ? { text: unseen.map((reply) => reply.text).filter(Boolean).join('\n\n'), tools: unseen.flatMap((reply) => reply.tools).slice(0, 50) }
          : live?.snapshot() ?? { text: '执行已中断，请在电脑检查会话。', tools: [] }
        if (done && live) live.finalizing = true
        stage = 'send'
        let card = binding.card
        if (!card) {
          const id = await transport.createCard(snapshot)
          card = { id, uuid: createHash('sha256').update(`${binding.sessionId}:${id}`).digest('hex').slice(0, 32), sequence: 0, sent: false, finishing: false }
          stage = 'receipt'
          this.persist({ ...this.record, conversation: { ...binding, card } })
          binding.card = card
        }
        if (!card.sent) {
          stage = 'send'
          await transport.sendCard(binding.chatId, card.id, card.uuid)
          card = { ...card, sent: true }
          stage = 'receipt'
          this.persist({ ...this.record, conversation: { ...binding, card } })
          binding.card = card
        }
        if (done || revision !== this.syncedRevision) {
          const sequence = card.sequence + 1
          card = { ...card, sequence: sequence + 1, finishing: done }
          stage = 'receipt'
          this.persist({ ...this.record, conversation: { ...binding, card } })
          binding.card = card
          stage = 'send'
          await transport.updateCard(card.id, snapshot, sequence, done)
          this.syncedRevision = revision
          if (done) {
            const { card: _card, ...completed } = binding
            stage = 'receipt'
            this.persist({ ...this.record, conversation: { ...completed, delivered: [...binding.delivered, ...unseen.map((reply) => reply.id)].slice(-2000) } })
            if (this.live?.reply === live) this.live = undefined
            this.syncedRevision = -1
          }
        }
      }
      if (busy) return
      const failure = this.conversations.failure(binding)
      if (failure) {
        stage = 'send'
        await transport.send(binding.chatId, failure, createHash('sha256').update(`${binding.sessionId}:failure:${Date.now()}`).digest('hex').slice(0, 32))
        this.conversations.clearFailure(binding)
      }
      this.error = undefined
    } catch (error) {
      const failures = {
        project: '回复同步暂停：项目授权检查失败，请在桌面重新选择并授权项目。',
        transcript: '回复同步暂停：无法读取绑定会话，请在电脑确认会话可打开，或通过 /会话 重新选择。',
        send: '会话已读取，但飞书发送失败，将重试。请检查 cardkit:card:write、机器人发送权限和网络。',
        receipt: '回复已发送，但本地回执保存失败。请检查系统安全存储和磁盘空间。',
      }
      this.error = error instanceof FeishuConversationError ? `回复同步暂停：${error.message}` : failures[stage]
    }
    finally { this.handling = wasHandling }
  }
}
