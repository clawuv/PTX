import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { AGENT_THINKING_LEVELS, type AgentEventEnvelope } from '../../../src/types/api'
import { TASK_STATUSES, type DevelopmentTask, type TaskInput, type TaskStatus, type TaskTemplate } from '../../../src/types/tasks'
import type { GitService } from '../git'
import type { HarnessRuntimeMap } from '../harness-runtime'
import { isPathWithin, rejectUnknownKeys, requireId, requireRecord, requireString } from '../validation'

type TaskHarness = {
  projects: Pick<HarnessRuntimeMap['pi']['projects'], 'list' | 'authorizeCwd'>
  agents: Pick<HarnessRuntimeMap['pi']['agents'], 'start' | 'stop' | 'command' | 'list'>
  sessions: Pick<HarnessRuntimeMap['pi']['sessions'], 'list' | 'read'>
}
interface TaskState { version: 1; tasks: DevelopmentTask[]; templates: TaskTemplate[] }
const ACTIVE: readonly TaskStatus[] = ['running', 'waiting']
const text = (value: unknown, name: string, max = 16_000) => requireString(value, name, { min: 1, max, trim: true })

function inputFrom(raw: unknown): TaskInput {
  const input = requireRecord(raw, 'task')
  rejectUnknownKeys(input, ['projectId', 'harness', 'cwd', 'model', 'thinking', 'title', 'goal', 'acceptance'])
  if (input.harness !== 'pi' && input.harness !== 'omp') throw new TypeError('Invalid task harness')
  if (input.thinking !== undefined && !AGENT_THINKING_LEVELS.some((level) => level === input.thinking)) throw new TypeError('Invalid thinking level')
  return {
    projectId: requireId(input.projectId), harness: input.harness, cwd: text(input.cwd, 'cwd', 4096), model: text(input.model, 'model', 256),
    ...(input.thinking !== undefined ? { thinking: input.thinking as TaskInput['thinking'] } : {}),
    title: text(input.title, 'title', 160), goal: text(input.goal, 'goal'), acceptance: text(input.acceptance, 'acceptance'),
  }
}

function templateFrom(raw: unknown): Omit<TaskTemplate, 'id'> {
  const input = requireRecord(raw, 'template')
  rejectUnknownKeys(input, ['name', 'goal', 'acceptance'])
  return { name: text(input.name, 'name', 160), goal: text(input.goal, 'goal'), acceptance: text(input.acceptance, 'acceptance') }
}

function loadState(file: string): TaskState {
  if (!existsSync(file)) return { version: 1, tasks: [], templates: [] }
  if (statSync(file).size > 16 * 1024 * 1024) throw new Error('Task store exceeds size limit')
  const raw = requireRecord(JSON.parse(readFileSync(file, 'utf8')), 'task store')
  if (raw.version !== 1 || !Array.isArray(raw.tasks) || !Array.isArray(raw.templates) || raw.tasks.length > 500 || raw.templates.length > 100) {
    throw new Error('Unsupported or invalid task store')
  }
  const tasks = raw.tasks.map((value: unknown): DevelopmentTask => {
    const task = requireRecord(value, 'stored task')
    const input = inputFrom(Object.fromEntries(['projectId', 'harness', 'cwd', 'model', 'thinking', 'title', 'goal', 'acceptance']
      .filter((key) => task[key] !== undefined).map((key) => [key, task[key]])))
    if (!TASK_STATUSES.some((status) => status === task.status) || !Array.isArray(task.history) || task.history.length > 200) throw new Error('Invalid task state')
    const history = task.history.map((value: unknown) => {
      const entry = requireRecord(value, 'transition')
      if (!TASK_STATUSES.some((status) => status === entry.status)) throw new Error('Invalid task transition')
      return { status: entry.status as TaskStatus, at: text(entry.at, 'at', 64), ...(entry.note ? { note: text(entry.note, 'note') } : {}) }
    })
    return {
      ...input, id: requireId(task.id), projectName: text(task.projectName, 'project name', 512), status: task.status as TaskStatus,
      createdAt: text(task.createdAt, 'createdAt', 64), updatedAt: text(task.updatedAt, 'updatedAt', 64), history,
      ...(task.runtimeId ? { runtimeId: requireId(task.runtimeId) } : {}),
      ...(task.sessionFile ? { sessionFile: text(task.sessionFile, 'session file', 4096) } : {}),
      ...(task.sessionId ? { sessionId: requireId(task.sessionId) } : {}),
      ...(task.error ? { error: text(task.error, 'error') } : {}),
    }
  })
  const templates = raw.templates.map((value: unknown) => {
    const item = requireRecord(value, 'stored template')
    return { id: requireId(item.id), ...templateFrom({ name: item.name, goal: item.goal, acceptance: item.acceptance }) }
  })
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length || new Set(templates.map((item) => item.id)).size !== templates.length) throw new Error('Duplicate task store ids')
  return { version: 1, tasks, templates }
}

/** Task metadata only. Harness-owned transcripts are always accessed read-only. */
export class TaskService {
  private state: TaskState = { version: 1, tasks: [], templates: [] }
  private loadError?: Error
  private durable: TaskState = structuredClone(this.state)
  private locks = new Set<string>()

  constructor(private file: string, private harnesses: Readonly<Record<'pi' | 'omp', TaskHarness>>, private git: Pick<GitService, 'status'>) {
    try {
      this.state = loadState(file)
      this.durable = structuredClone(this.state)
      let interrupted = false
      for (const task of this.state.tasks) {
        if (!ACTIVE.includes(task.status)) continue
        task.status = 'failed'
        task.error = 'Execution interrupted by app shutdown. Inspect the session before retrying.'
        task.updatedAt = new Date().toISOString()
        task.history = [...task.history, { status: 'failed' as const, at: task.updatedAt, note: task.error }].slice(-200)
        interrupted = true
      }
      if (interrupted) this.persist()
    } catch (error) {
      this.loadError = new Error(`Cannot load task records; the original file was preserved. ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private ready(): void { if (this.loadError) throw this.loadError }

  private persist(): void {
    this.ready()
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      const data = JSON.stringify(this.state)
      if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error('Task store exceeds size limit')
      mkdirSync(dirname(this.file), { recursive: true })
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, data); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, this.file)
      this.durable = structuredClone(this.state)
    } catch (error) {
      this.state = structuredClone(this.durable)
      throw error
    } finally { if (existsSync(temp)) unlinkSync(temp) }
  }

  private task(rawId: unknown): DevelopmentTask {
    this.ready()
    const task = this.state.tasks.find((item) => item.id === requireId(rawId))
    if (!task) throw new Error('Task not found')
    return task
  }

  private transition(task: DevelopmentTask, status: TaskStatus, note?: string): void {
    task.status = status
    task.updatedAt = new Date().toISOString()
    task.error = status === 'failed' ? note : undefined
    task.history = [...task.history, { status, at: task.updatedAt, ...(note ? { note } : {}) }].slice(-200)
    this.persist()
  }

  private async authorize(input: TaskInput): Promise<string> {
    const projects = this.harnesses[input.harness].projects
    const project = (await projects.list()).find((item) => item.id === input.projectId)
    if (!project || project.inferred || project.readOnly || project.harness !== input.harness) throw new Error('Task requires an explicitly added writable project for this harness')
    const cwd = await projects.authorizeCwd(input.cwd)
    if (![project.primaryFolder, ...project.folders].some((root) => isPathWithin(root, cwd))) throw new Error('Task directory does not belong to its project')
    return cwd
  }

  list(): DevelopmentTask[] {
    this.ready()
    return structuredClone(this.state.tasks).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(raw: unknown): Promise<DevelopmentTask> {
    this.ready()
    const input = inputFrom(raw)
    input.cwd = await this.authorize(input)
    if (this.state.tasks.length >= 500) throw new Error('Task history is full (500 records)')
    const project = (await this.harnesses[input.harness].projects.list()).find((item) => item.id === input.projectId)
    const at = new Date().toISOString()
    const task: DevelopmentTask = {
      ...input, id: randomUUID(), projectName: project?.name ?? input.projectId, status: 'draft', createdAt: at, updatedAt: at,
      history: [{ status: 'draft', at }],
    }
    this.state.tasks.push(task)
    this.persist()
    return structuredClone(task)
  }

  async start(rawId: unknown): Promise<DevelopmentTask> {
    const task = this.task(rawId)
    if (this.locks.has(task.id) || ACTIVE.includes(task.status)) throw new Error('Task is already running')
    if (task.status !== 'draft' && task.status !== 'failed') throw new Error('Only draft or failed tasks can start')
    this.locks.add(task.id)
    let startedRuntime: string | undefined
    try {
      task.cwd = await this.authorize(task)
      const agents = this.harnesses[task.harness].agents
      if (task.sessionFile) {
        const session = (await this.harnesses[task.harness].sessions.list(task.cwd, true, true)).find((item) => item.filePath === task.sessionFile && item.harness === task.harness)
        if (!session) throw new Error('Task session no longer belongs to its project and harness')
      }
      const other = this.state.tasks.find((item) => item.id !== task.id && ACTIVE.includes(item.status) && (isPathWithin(item.cwd, task.cwd) || isPathWithin(task.cwd, item.cwd)))
      if (other) throw new Error('Another task is running in this directory. Use a separate worktree.')
      const activeRuntime = Object.values(this.harnesses).flatMap((harness) => harness.agents.list()).find((runtime) =>
        (runtime.isStreaming || runtime.isCompacting) && (isPathWithin(runtime.cwd, task.cwd) || isPathWithin(task.cwd, runtime.cwd)))
      if (activeRuntime) throw new Error('An agent is already working in this directory. Use a separate worktree.')
      this.transition(task, 'running')
      const previousRuntime = task.runtimeId
      task.runtimeId = undefined
      if (previousRuntime && agents.list().some((runtime) => runtime.runtimeId === previousRuntime)) await agents.stop(previousRuntime)
      const runtime = await agents.start({ cwd: task.cwd, model: task.model, ...(task.thinking ? { thinking: task.thinking } : {}),
        ...(task.sessionFile ? { sessionPath: task.sessionFile } : {}) })
      startedRuntime = runtime.runtimeId
      if (runtime.harness !== task.harness || runtime.cwd !== task.cwd) throw new Error('Runtime harness does not match the task')
      if (runtime.model?.provider && runtime.model.id && `${runtime.model.provider}/${runtime.model.id}` !== task.model) throw new Error('Runtime model does not match the task')
      task.runtimeId = runtime.runtimeId
      task.sessionFile = runtime.sessionFile
      task.sessionId = runtime.sessionId
      this.persist()
      void agents.command(runtime.runtimeId, { type: 'prompt', message: `Task: ${task.title}\n\nGoal:\n${task.goal}\n\nAcceptance requirements:\n${task.acceptance}\n\nRun applicable checks and report actual commands, results, and anything requiring human review. Do not claim human acceptance.` }).then((response) => {
        if (response.success === false) throw new Error(String(response.error ?? 'Prompt was rejected'))
      }).catch(async (error: unknown) => {
        if (task.runtimeId !== runtime.runtimeId || task.status === 'accepted') return
        try { this.transition(task, 'failed', (error instanceof Error ? error.message : String(error)).slice(0, 16_000)) }
        catch (failure) { console.error('Task prompt failure could not be persisted', failure) }
        await agents.stop(runtime.runtimeId).catch(() => undefined)
      })
      return structuredClone(task)
    } catch (error) {
      if (startedRuntime) await this.harnesses[task.harness].agents.stop(startedRuntime).catch(() => undefined)
      this.transition(task, 'failed', (error instanceof Error ? error.message : String(error)).slice(0, 16_000))
      throw error
    } finally { this.locks.delete(task.id) }
  }

  onAgentEvent({ runtimeId, event }: AgentEventEnvelope): void {
    if (this.loadError) return
    const task = this.state.tasks.find((item) => item.runtimeId === runtimeId)
    if (!task || task.status === 'accepted' || task.status === 'draft') return
    if (event.type === 'agent_start' || event.type === 'auto_retry_start') this.transition(task, 'running')
    else if (ACTIVE.includes(task.status) && event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(String(event.method))) this.transition(task, 'waiting')
    else if (event.type === 'extension_ui_response' && task.status === 'waiting') this.transition(task, 'running')
    else if (event.type === 'agent_end' && event.isTerminal !== false && task.status !== 'failed') this.transition(task, 'review')
    else if (event.type === 'error' || event.type === 'extension_error' || event.type === 'transport_error' || (event.type === 'runtime_exit' && ACTIVE.includes(task.status))
      || (event.type === 'auto_retry_end' && event.success !== true)) this.transition(task, 'failed', String(event.error ?? 'Agent execution ended unexpectedly').slice(0, 16_000))
    else if (event.type === 'message_end') {
      const message = event.message
      if (message && typeof message === 'object' && 'stopReason' in message && ['error', 'aborted'].includes(String(message.stopReason))) {
        this.transition(task, 'failed', 'Agent reported an error or was interrupted. Inspect the session for details.')
      }
    }
  }

  async stop(rawId: unknown): Promise<DevelopmentTask> {
    const task = this.task(rawId)
    if (this.locks.has(task.id)) throw new Error('Task is starting; try again shortly')
    if (!ACTIVE.includes(task.status) || !task.runtimeId) throw new Error('Task is not running')
    await this.harnesses[task.harness].agents.stop(task.runtimeId)
    this.transition(task, 'failed', 'Stopped by user. Inspect the session before retrying.')
    return structuredClone(task)
  }

  accept(rawId: unknown): DevelopmentTask {
    const task = this.task(rawId)
    if (task.status !== 'review' || this.locks.has(task.id)) throw new Error('Only tasks awaiting review can be accepted')
    const runtime = this.harnesses[task.harness].agents.list().find((item) => item.runtimeId === task.runtimeId)
    if (runtime?.isStreaming || runtime?.isCompacting) throw new Error('Task runtime is still active')
    this.transition(task, 'accepted', 'Accepted manually by user')
    return structuredClone(task)
  }

  async revise(rawId: unknown, rawInstructions: unknown): Promise<DevelopmentTask> {
    const task = this.task(rawId)
    const instructions = text(rawInstructions, 'revision instructions')
    if (task.status !== 'review' && task.status !== 'failed') throw new Error('Task cannot be revised in its current state')
    if (this.locks.has(task.id)) throw new Error('Task is busy')
    task.goal = text(`${task.goal}\n\nRequested revision:\n${instructions}`, 'goal')
    this.transition(task, 'draft', instructions)
    return structuredClone(task)
  }

  async evidence(rawId: unknown) {
    const task = structuredClone(this.task(rawId))
    await this.authorize(task)
    const runtime = this.harnesses[task.harness]
    // Resolve using the harness-owned catalog; never accept arbitrary transcript paths from the renderer.
    const session = task.sessionFile ? (await runtime.sessions.list(task.cwd, true, true)).find((item) => item.filePath === task.sessionFile && item.harness === task.harness) : undefined
    if (task.sessionFile && !session) throw new Error('Task session is unavailable; evidence cannot be loaded')
    const messages = session ? await runtime.sessions.read(session.filePath) : []
    const git = await this.git.status(task.cwd)
    return { capturedAt: new Date().toISOString(), git, messages }
  }

  templates(): TaskTemplate[] { this.ready(); return structuredClone(this.state.templates) }

  saveTemplate(raw: unknown): TaskTemplate {
    this.ready()
    const input = templateFrom(raw)
    if (this.state.templates.length >= 100) throw new Error('Template library is full (100 templates)')
    const template = { id: randomUUID(), ...input }
    this.state.templates.push(template)
    this.persist()
    return structuredClone(template)
  }

  deleteTemplate(rawId: unknown): void {
    this.ready()
    const id = requireId(rawId)
    this.state.templates = this.state.templates.filter((item) => item.id !== id)
    this.persist()
  }
}
