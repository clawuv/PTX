import type { ReplyCard } from '../../electron/main/feishu/cards'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuService } from '../../electron/main/feishu/service'
import { FeishuStore } from '../../electron/main/feishu/store'
import { admittedMessage, parseCommand, parseConfig } from '../../electron/main/feishu/protocol'

import type { ProjectRecord, RuntimeInfo, SessionRecord, TranscriptMessage } from '../../src/types/api'
import type { FeishuConfig } from '../../src/types/feishu'

let root: string
let services: FeishuService[]
const config: FeishuConfig = { appId: 'cli_test', allowedOpenId: 'ou_owner', harness: 'pi', projectId: 'pi-project', model: 'provider/model' }
function event(text: string, id = 'message-1') {
  return { sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } }, message: {
    message_id: id, chat_id: 'chat-1', chat_type: 'p2p', message_type: 'text', create_time: String(Date.now()), content: JSON.stringify({ text }),
  } }
}
function fixture() {
  const file = join(root, 'feishu.enc')
  const key = randomBytes(32)
  let secure = true
  const codec = {
    available: () => secure,
    encrypt: (text: string) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decrypt: (bytes: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
  const store = new FeishuStore(file, codec)
  const project: ProjectRecord = { id: 'pi-project', harness: 'pi', name: 'Project', path: root, primaryFolder: root, folders: [root], pinned: false,
    createdAt: '', lastOpenedAt: '', sessionCount: 0 }
  let allowed = true
  const projects = { list: vi.fn(async () => allowed ? [project] : []), authorizeCwd: vi.fn(async () => {
    if (!allowed) throw new Error('revoked')
    return root
  }) }
  let current: RuntimeInfo | undefined
  const session: SessionRecord = { id: 'session', harness: 'pi', filePath: join(root, 'session.jsonl'), projectPath: root, title: 'Task', createdAt: '', updatedAt: '', status: 'idle', depth: 0 }
  const messages: TranscriptMessage[] = [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Tests passed. Please review the diff.' }] }]
  const agents = {
    start: vi.fn(async (): Promise<RuntimeInfo> => {
      current = { runtimeId: 'runtime', harness: 'pi', cwd: root, isStreaming: false, sessionFile: session.filePath, sessionId: session.id, model: { provider: 'provider', id: 'model' } }
      return current
    }),
    command: vi.fn(async () => ({ type: 'response', success: true })),
    getForSession: vi.fn(() => current),
    stop: vi.fn(async () => { current = undefined; return true }), list: vi.fn(() => current ? [current] : []),
  }
  const harness = { projects, agents, sessions: { registerPendingSession: vi.fn(async () => {}), list: vi.fn(async () => [session]), read: vi.fn(async () => messages) } }
  let receive: (raw: unknown) => Promise<void> = async () => {}
  const send = vi.fn(async (_chatId: string, _text: string, _uuid: string) => {})
  const close = vi.fn()
  const createCard = vi.fn(async (_reply: ReplyCard) => `card-${createCard.mock.calls.length}`)
  const sendCard = vi.fn(async (_chatId: string, _cardId: string, _uuid: string) => {})
  const updateCard = vi.fn(async (_id: string, _reply: ReplyCard, _sequence: number, _done: boolean) => {})
  const transport = { createCard, sendCard, updateCard, start: vi.fn(async (callback: typeof receive) => { receive = callback }), close, state: () => 'connected' as const, send }
  const make = () => {
    const service = new FeishuService(store, { pi: harness, omp: harness }, { pi: projects, omp: projects }, () => transport)
    services.push(service)
    return service
  }
  const service = make()
  return { service, make, store, file, harness, agents, messages, session, transport, receive: (raw: unknown) => receive(raw), send, revoke: () => { allowed = false }, insecure: () => { secure = false } }

}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ptx-feishu-')); services = [] })
afterEach(() => { for (const service of services) service.stop(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }) })

describe('Feishu admission', () => {
  it('admits only fresh text from the configured human in a private chat', () => {
    expect(admittedMessage(event('/状态'), 'ou_owner')).toMatchObject({ text: '/状态', chatId: 'chat-1' })
    expect(admittedMessage(event('/状态'), 'ou_other')).toBeNull()
    const group = event('/任务 change files'); group.message.chat_type = 'group'
    expect(admittedMessage(group, 'ou_owner')).toBeNull()
    const bot = event('/任务 change files'); bot.sender.sender_type = 'app'
    expect(admittedMessage(bot, 'ou_owner')).toBeNull()
    const old = event('/任务 change files'); old.message.create_time = String(Date.now() - 301_000)
    expect(admittedMessage(old, 'ou_owner')).toBeNull()
    const image = event('/任务 change files'); image.message.message_type = 'image'
    expect(admittedMessage(image, 'ou_owner')).toBeNull()
    expect(admittedMessage({ message: { content: '{' } }, 'ou_owner')).toBeNull()
  })
  it('requires an explicit task command and rejects extra configuration keys', () => {
    expect(parseCommand('continue this')).toEqual({ kind: 'message', prompt: 'continue this' })
    expect(parseCommand('/任务 修复测试')).toEqual({ kind: 'message', prompt: '修复测试' })
    expect(() => parseConfig({ ...config, cwd: '/' })).toThrow()
    expect(() => parseConfig({ ...config, harness: 'other' })).toThrow()
  })
})

describe('Feishu local execution', () => {
  it('saves scanned credentials only through the authorized project path and keeps secrets off IPC', async () => {
    const f = fixture()
    const credentials = vi.spyOn(f.service.binding, 'requireCredentials').mockReturnValue({ appId: 'cli_scanned', secret: 'scan-secret', openId: 'ou_scanner' })
    const result = await f.service.finishBinding({ harness: 'pi', projectId: 'pi-project', model: 'provider/model' })
    expect(result.config).toMatchObject({ appId: 'cli_scanned', allowedOpenId: 'ou_scanner' })
    expect(result.enabled).toBe(false)
    expect(JSON.stringify(result)).not.toContain('scan-secret')
    expect(f.store.load()?.secret).toBe('scan-secret')
    f.revoke()
    await expect(f.service.finishBinding({ harness: 'pi', projectId: 'pi-project', model: 'provider/model' })).rejects.toThrow('授权')
    expect(f.store.load()?.config.appId).toBe('cli_scanned')
    credentials.mockRestore()
  })

  it('encrypts credentials and never returns the secret over status', async () => {
    const f = fixture()
    await f.service.save(config, 'secret-value')
    expect(JSON.stringify(f.service.status())).not.toContain('secret-value')
    expect(readFileSync(f.file).includes(Buffer.from('secret-value'))).toBe(false)
    expect(f.store.load()?.secret).toBe('secret-value')
    if (process.platform !== 'win32') expect(statSync(f.file).mode & 0o777).toBe(0o600)
    f.insecure()
    expect(() => f.store.load()).toThrow('安全存储')
    await expect(f.service.save(config, 'replacement')).rejects.toThrow('安全存储')
  })
  it('creates one desktop session and continues it for ordinary messages, including after restart', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('修复测试'))
    await f.receive(event('解释刚才的修改', 'second'))
    expect(f.agents.start).toHaveBeenCalledTimes(1)
    expect(f.harness.sessions.registerPendingSession).toHaveBeenCalledWith(expect.objectContaining({ title: '飞书会话', filePath: f.session.filePath }), 'runtime')
    const prompts = f.agents.command.mock.calls.filter((call) => (call as unknown[])[1] && ((call as unknown[])[1] as { type: string }).type === 'prompt')
    expect(prompts).toHaveLength(2)
    expect(f.store.load()?.conversation?.sessionId).toBe('session')
    f.service.stop()
    await f.agents.stop()
    const restored = f.make()
    await restored.start()
    await f.receive(event('继续', 'third'))
    expect(f.agents.start).toHaveBeenLastCalledWith({ cwd: root, sessionPath: f.session.filePath })
    await f.receive(event('继续', 'third'))
    expect(f.agents.start).toHaveBeenCalledTimes(2)
  })
  it('delivers the first prompt before a lazy session exists and refreshes the catalog', async () => {
    const f = fixture()
    let saved = false
    f.harness.sessions.list.mockImplementation(async (_project?: unknown, _archived?: unknown, force?: unknown) => saved && force ? [f.session] : [])
    f.agents.command.mockImplementation(async (...args: unknown[]) => {
      const command = args[1]
      if (typeof command === 'object' && command !== null && 'type' in command && command.type === 'prompt') saved = true
      return { type: 'response', success: true }
    })
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('first'))
    expect(saved).toBe(true)
    expect(f.service.status().error).toBeUndefined()
    await f.receive(event('second', 'second'))
    expect(f.agents.start).toHaveBeenCalledTimes(1)
    expect(f.agents.command).toHaveBeenCalledWith('runtime', expect.objectContaining({ type: 'prompt', message: 'second' }))
    expect(f.harness.sessions.list).toHaveBeenCalledWith(undefined, true, true)
  })

  it('lists and switches only authorized project sessions without replaying old replies', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('/会话'))
    expect(f.send.mock.calls.at(-1)?.[1]).toContain('/切换 session')
    await f.receive(event('/切换 missing', 'missing'))
    expect(f.store.load()?.conversation).toBeUndefined()
    await f.receive(event('/切换 session', 'switch'))
    expect(f.store.load()?.conversation?.delivered).toEqual(['answer'])
    expect(f.agents.start).not.toHaveBeenCalled()
  })
  it('queues ordinary messages through the harness and stops the shared runtime', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('开始'))
    await f.receive(event('继续', 'followup'))
    expect(f.agents.command).toHaveBeenCalledWith('runtime', { type: 'prompt', message: '继续', streamingBehavior: 'followUp' })
    await f.receive(event('/停止', 'stop'))
    expect(f.agents.stop).toHaveBeenCalledWith('runtime')
    expect(f.store.load()?.conversation?.sessionId).toBe('session')
  })
  it('keeps stop responsive while an earlier prompt is still in flight and rejects switching', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('开始'))
    let release: () => void = () => {}
    f.agents.command.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ type: 'response', success: true }) }))
    await f.receive(event('长任务', 'long'))
    await f.receive(event('后续任务', 'queued'))
    expect(f.agents.command).toHaveBeenCalledWith('runtime', { type: 'follow_up', message: '后续任务' })
    await f.receive(event('/新建', 'new'))
    expect(f.agents.start).toHaveBeenCalledTimes(1)
    expect(f.send.mock.calls.at(-1)?.[1]).toContain('仍在运行')
    await f.receive(event('/停止', 'stop'))
    expect(f.agents.stop).toHaveBeenCalledWith('runtime')
    release()
  })
  it('rejects archived sessions and uses a new session only when explicitly requested', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('/新建'))
    expect(f.agents.start).toHaveBeenCalledTimes(1)
    writeFileSync(f.session.filePath, '')
    f.session.archived = true
    await f.receive(event('继续', 'archived'))
    expect(f.agents.command).not.toHaveBeenCalledWith('runtime', expect.objectContaining({ message: '继续' }))
    expect(f.agents.start).toHaveBeenCalledTimes(1)
  })

  it('rechecks project access before each message and response', async () => {
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    f.revoke()
    await f.receive(event('run tests'))
    expect(f.agents.start).not.toHaveBeenCalled()
    expect(f.send.mock.calls.at(-1)?.[1]).toContain('授权已失效')
  })
  it('explains an unsaved binding after restart and recovers with an explicit new session', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.harness.sessions.list.mockResolvedValue([])
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('/新建'))
    f.service.stop()
    await f.agents.stop()
    const restored = f.make()
    await restored.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(restored.status().error).toContain('尚未保存')
    expect(restored.status().error).toContain('/新建')
    expect(f.send).toHaveBeenCalledTimes(1)
    await f.receive(event('/新建', 'new-after-restart'))
    await f.receive(event('first message', 'first-after-restart'))
    expect(f.agents.command).toHaveBeenCalledWith('runtime', expect.objectContaining({ message: 'first message' }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(restored.status().error).toBeUndefined()
  })

  it('identifies failed delivery and retries the same receipt without acknowledging it early', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('run tests'))
    f.transport.sendCard.mockRejectedValueOnce(new Error('secret must not appear in status'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.service.status().error).toContain('会话已读取，但飞书发送失败')
    expect(f.service.status().error).not.toContain('secret')
    expect(f.store.load()?.conversation?.delivered).toEqual([])
    const failedReceipt = f.transport.sendCard.mock.calls.at(-1)?.[2]
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.sendCard.mock.calls.at(-1)?.[2]).toBe(failedReceipt)
    expect(f.store.load()?.conversation?.delivered).toEqual(['answer'])
    expect(f.service.status().error).toBeUndefined()
  })

  it('streams live text to one card, excludes tool payloads, and finalizes from the transcript', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('run tests'))
    const runtime = f.agents.getForSession()
    if (!runtime) throw new Error('missing runtime')
    runtime.isStreaming = true
    f.service.onAgentEvent({ runtimeId: 'unrelated', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'private-other-project' } } })
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private-reasoning' } } })
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Checking' } } })
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'tool_execution_start', toolCallId: 'one', toolName: 'Read', args: { secret: 'private-argument' } } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.createCard).toHaveBeenCalledTimes(1)
    expect(f.transport.updateCard).toHaveBeenLastCalledWith('card-1', { text: 'Checking', tools: [{ name: 'Read', status: 'running' }] }, 1, false)
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'tool_execution_end', toolCallId: 'one', toolName: 'Read', result: 'private-output' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.updateCard.mock.calls.at(-1)?.[2]).toBe(3)
    runtime.isStreaming = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.updateCard).toHaveBeenLastCalledWith('card-1', expect.objectContaining({ text: 'Tests passed. Please review the diff.' }), 5, true)
    expect(f.transport.sendCard).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.transport.updateCard.mock.calls)).not.toContain('private-')
    expect(f.store.load()?.conversation?.card).toBeUndefined()
    expect(f.store.load()?.conversation?.delivered).toEqual(['answer'])
  })

  it('recovers the same card after restart and advances sequences after a failed final update', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('run tests'))
    const runtime = f.agents.getForSession()
    if (!runtime) throw new Error('missing runtime')
    runtime.isStreaming = true
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.store.load()?.conversation?.card).toMatchObject({ id: 'card-1', sent: true, sequence: 2 })
    f.service.stop()
    runtime.isStreaming = false
    const restored = f.make()
    await restored.start()
    f.transport.updateCard.mockRejectedValueOnce(new Error('network failure'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.store.load()?.conversation?.card).toMatchObject({ id: 'card-1', finishing: true, sequence: 4 })
    expect(f.store.load()?.conversation?.delivered).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.updateCard).toHaveBeenLastCalledWith('card-1', expect.any(Object), 5, true)
    expect(f.transport.createCard).toHaveBeenCalledTimes(1)
    expect(f.transport.sendCard).toHaveBeenCalledTimes(1)
    expect(f.store.load()?.conversation?.delivered).toEqual(['answer'])
  })

  it('does not continue a live card after project access is revoked', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('run tests'))
    const runtime = f.agents.getForSession()
    if (!runtime) throw new Error('missing runtime')
    runtime.isStreaming = true
    f.service.onAgentEvent({ runtimeId: 'runtime', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } } })
    await vi.advanceTimersByTimeAsync(1000)
    f.revoke()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.transport.updateCard).toHaveBeenCalledTimes(1)
    expect(f.service.status().error).toContain('授权已失效')
  })

  it('sends assistant replies once and receives desktop replies through the same transcript', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.save(config, 'secret')
    await f.service.connect()
    await f.receive(event('run tests'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.transport.updateCard.mock.calls.at(-1)?.[1].text).toContain('Tests passed')
    const count = f.transport.updateCard.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.transport.updateCard).toHaveBeenCalledTimes(count)
    f.messages.push({ id: 'desktop-answer', role: 'assistant', parts: [{ type: 'text', text: 'Desktop follow-up reply' }] })
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.transport.updateCard.mock.calls.at(-1)?.[1].text).toBe('Desktop follow-up reply')
  })
})
