import { summarizeTools } from './cards'
import { existsSync } from 'node:fs'
import type { HarnessRuntimeMap } from '../harness-runtime'
import type { FeishuConfig } from '../../../src/types/feishu'
import type { RuntimeInfo, SessionRecord } from '../../../src/types/api'
import { assertNoMcpAuthenticationCommand } from '../../../src/lib/mcp-policy'

export type ConversationHarness = {
  projects: Pick<HarnessRuntimeMap['pi']['projects'], 'list' | 'authorizeCwd'>
  sessions: Pick<HarnessRuntimeMap['pi']['sessions'], 'list' | 'read' | 'registerPendingSession'>
  agents: Pick<HarnessRuntimeMap['pi']['agents'], 'start' | 'stop' | 'command' | 'getForSession' | 'list'>
}
export interface MobileConversation {
  sessionFile: string
  sessionId: string
  chatId: string
  title: string
  delivered: string[]
  card?: { id: string; uuid: string; sequence: number; sent: boolean; finishing: boolean }
}

export class FeishuConversationError extends Error {}

/** Uses the same runtime and transcript catalog as the desktop, never a parallel chat log. */
export class FeishuConversations {
  private fresh = new Map<string, { runtimeId: string; cwd: string; sessionId: string }>()
  private deliveries = new Map<string, number>()
  private failures = new Map<string, string>()
  constructor(private harnesses: Record<'pi' | 'omp', ConversationHarness>) {}

  async list(config: FeishuConfig, force = false): Promise<SessionRecord[]> {
    const harness = this.harnesses[config.harness]
    const project = (await harness.projects.list()).find((item) => item.id === config.projectId && !item.inferred && !item.readOnly)
    if (!project) throw new FeishuConversationError('项目授权已失效')
    await harness.projects.authorizeCwd(project.primaryFolder)
    return (await harness.sessions.list(undefined, true, force)).filter((session) => session.harness === config.harness && !session.archived
      && [project.primaryFolder, ...project.folders].includes(session.projectPath))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async require(config: FeishuConfig, binding: MobileConversation): Promise<SessionRecord> {
    const matches = (item: SessionRecord) => item.filePath === binding.sessionFile && item.id === binding.sessionId
    const session = (await this.list(config)).find(matches) ?? (await this.list(config, true)).find(matches)
    if (session) {
      this.fresh.delete(binding.sessionFile)
      await this.harnesses[config.harness].projects.authorizeCwd(session.projectPath)
      return session
    }
    const fresh = this.fresh.get(binding.sessionFile)
    const runtime = this.harnesses[config.harness].agents.getForSession(binding.sessionFile)
    if (existsSync(binding.sessionFile) || !fresh || fresh.sessionId !== binding.sessionId || runtime?.runtimeId !== fresh.runtimeId || runtime.harness !== config.harness) {
      throw new FeishuConversationError('会话已删除、归档或尚未保存，请发送 /新建 后重试')
    }
    await this.harnesses[config.harness].projects.authorizeCwd(fresh.cwd)
    const project = (await this.harnesses[config.harness].projects.list()).find((item) => item.id === config.projectId && !item.inferred && !item.readOnly)
    if (!project || ![project.primaryFolder, ...project.folders].includes(fresh.cwd)) throw new FeishuConversationError('项目授权已失效')
    return { id: binding.sessionId, filePath: binding.sessionFile, harness: config.harness, projectPath: fresh.cwd,
      title: binding.title, createdAt: '', updatedAt: '', status: 'idle', depth: 0 }
  }

  async create(config: FeishuConfig, cwd: string, chatId: string): Promise<MobileConversation> {
    const agents = this.harnesses[config.harness].agents
    const runtime = await agents.start({ cwd, model: config.model }).catch(() => {
      throw new FeishuConversationError('会话启动失败，请在设置中检查所选引擎和模型是否可用')
    })
    try {
      await agents.command(runtime.runtimeId, { type: 'set_session_name', name: '飞书会话' })
      await agents.command(runtime.runtimeId, { type: 'get_state' })
      const current = agents.list().find((item) => item.runtimeId === runtime.runtimeId) ?? runtime
      if (!current.sessionFile || !current.sessionId) throw new FeishuConversationError('引擎尚未创建会话，请重试')
      const timestamp = new Date().toISOString()
      await this.harnesses[config.harness].sessions.registerPendingSession({
        id: current.sessionId, filePath: current.sessionFile, harness: config.harness, projectPath: cwd,
        title: '飞书会话', createdAt: timestamp, updatedAt: timestamp, status: 'idle', depth: 0,
      }, current.runtimeId)
      this.fresh.set(current.sessionFile, { runtimeId: current.runtimeId, cwd, sessionId: current.sessionId })
      return { sessionFile: current.sessionFile, sessionId: current.sessionId, chatId, title: '飞书会话', delivered: [] }
    } catch (error) { await agents.stop(runtime.runtimeId); throw error }
  }

  ownsRuntime(config: FeishuConfig, binding: MobileConversation, runtimeId: string): boolean {
    return this.harnesses[config.harness].agents.getForSession(binding.sessionFile)?.runtimeId === runtimeId
  }

  busy(config: FeishuConfig, binding: MobileConversation): boolean {
    const runtime = this.harnesses[config.harness].agents.getForSession(binding.sessionFile)
    return Boolean(runtime?.isStreaming || runtime?.isCompacting || this.deliveries.get(binding.sessionFile))
  }

  async send(config: FeishuConfig, binding: MobileConversation, prompt: string): Promise<void> {
    assertNoMcpAuthenticationCommand(prompt, config.harness)
    const session = await this.require(config, binding)
    const agents = this.harnesses[config.harness].agents
    const count = this.deliveries.get(binding.sessionFile) ?? 0
    if (count >= 32) throw new FeishuConversationError('消息队列已满，请等待回复')
    const runtime: RuntimeInfo = agents.getForSession(binding.sessionFile)
      ?? await agents.start({ cwd: session.projectPath, sessionPath: session.filePath })
    if (runtime.harness !== config.harness || runtime.sessionFile !== binding.sessionFile) throw new FeishuConversationError('会话恢复不一致，未发送消息')
    this.deliveries.set(binding.sessionFile, count + 1)
    this.failures.delete(binding.sessionFile)
    // The harness owns the queue. Do not block the incoming /stop command on completion.
    void agents.command(runtime.runtimeId, runtime.isStreaming || runtime.isCompacting || count > 0
      ? { type: 'follow_up', message: prompt }
      : { type: 'prompt', message: prompt, streamingBehavior: 'followUp' }).then((response) => {
      if (response.success === false) throw new FeishuConversationError('消息被引擎拒绝')
    }).catch(() => { this.failures.set(binding.sessionFile, '消息执行失败或被中断，请在电脑查看会话；不会自动重发。') })
      .finally(() => {
        const remaining = (this.deliveries.get(binding.sessionFile) ?? 1) - 1
        if (remaining > 0) this.deliveries.set(binding.sessionFile, remaining)
        else this.deliveries.delete(binding.sessionFile)
      })
  }

  async stop(config: FeishuConfig, binding: MobileConversation): Promise<void> {
    await this.require(config, binding)
    const agents = this.harnesses[config.harness].agents
    const runtime = agents.getForSession(binding.sessionFile)
    if (runtime) await agents.stop(runtime.runtimeId)
  }

  async replies(config: FeishuConfig, binding: MobileConversation) {
    await this.require(config, binding)
    if (this.fresh.has(binding.sessionFile)) return []
    return (await this.harnesses[config.harness].sessions.read(binding.sessionFile))
      .filter((message) => message.role === 'assistant' && !message.streaming)
      .map((message) => ({ id: message.id, tools: summarizeTools(message.parts), text: message.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n') }))
      .filter((message) => message.text.trim() || message.tools.length)
  }

  failure(binding: MobileConversation): string | undefined { return this.failures.get(binding.sessionFile) }
  clearFailure(binding: MobileConversation): void { this.failures.delete(binding.sessionFile) }
}
