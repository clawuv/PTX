import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskService } from '../../electron/main/tasks/service'
import type { HarnessId, ProjectRecord, RuntimeInfo, SessionRecord, TranscriptMessage } from '../../src/types/api'
import type { TaskInput } from '../../src/types/tasks'

let root: string
const at = '2026-10-17T00:00:00.000Z'
function fixture() {
  const project = (harness: HarnessId): ProjectRecord => ({ id: harness, harness, name: `${harness} project`, path: join(root, harness), primaryFolder: join(root, harness),
    folders: [join(root, harness)], pinned: false, createdAt: at, lastOpenedAt: at, sessionCount: 0 })
  const createHarness = (harness: HarnessId) => {
    const record = project(harness)
    let current: RuntimeInfo | undefined
    const session: SessionRecord = { id: `${harness}-session`, harness, filePath: join(root, `${harness}.jsonl`), projectPath: record.path, title: 'task', createdAt: at, updatedAt: at, status: 'idle', depth: 0 }
    const transcript: TranscriptMessage[] = [{ id: 'tool', role: 'tool', parts: [{ type: 'toolResult', name: 'bash', text: 'tests failed', isError: true }] }]
    return {
      projects: { list: vi.fn(async () => [record]), authorizeCwd: vi.fn(async (value: unknown) => String(value)) },
      agents: {
        start: vi.fn(async (raw: unknown): Promise<RuntimeInfo> => {
          const input = raw as { cwd: string }
          current = { runtimeId: `${harness}-runtime`, harness, cwd: input.cwd, sessionFile: session.filePath, sessionId: session.id, isStreaming: false }
          return current
        }),
        command: vi.fn(async () => ({ type: 'response', success: true })),
        stop: vi.fn(async () => { current = undefined; return true }),
        list: vi.fn(() => current ? [current] : []),
      },
      sessions: { list: vi.fn(async () => [session]), read: vi.fn(async () => transcript) },
    }
  }
  const harnesses = { pi: createHarness('pi'), omp: createHarness('omp') }
  const git = { status: vi.fn(async () => ({ isRepo: true, files: [] })) }
  const file = join(root, 'tasks.json')
  const service = new TaskService(file, harnesses, git)
  const input: TaskInput = { harness: 'pi', projectId: 'pi', cwd: join(root, 'pi'), model: 'provider/model', thinking: 'high', title: 'Fix feature', goal: 'Implement the feature', acceptance: 'Run checks and inspect changes' }
  return { service, harnesses, git, file, input }
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ptx-tasks-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('task execution and acceptance', () => {
  it('persists a draft and dispatches only to its selected harness with the exact model', async () => {
    const { service, harnesses, input, file } = fixture()
    const draft = await service.create(input)
    expect(draft.status).toBe('draft')
    const running = await service.start(draft.id)
    expect(running).toMatchObject({ status: 'running', harness: 'pi', sessionFile: join(root, 'pi.jsonl') })
    expect(harnesses.pi.agents.start).toHaveBeenCalledWith({ cwd: input.cwd, model: input.model, thinking: 'high' })
    expect(harnesses.pi.agents.command).toHaveBeenCalledWith('pi-runtime', expect.objectContaining({ type: 'prompt', message: expect.stringContaining(input.acceptance) }))
    expect(harnesses.omp.agents.start).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[0].runtimeId).toBe('pi-runtime')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })
  it('never treats AI completion as acceptance; only explicit review can be accepted', async () => {
    const { service, input } = fixture()
    const task = await service.create(input)
    expect(() => service.accept(task.id)).toThrow('awaiting review')
    await service.start(task.id)
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'agent_end', isTerminal: false } })
    expect(service.list()[0].status).toBe('running')
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'agent_end' } })
    expect(service.list()[0].status).toBe('review')
    expect(service.accept(task.id).status).toBe('accepted')
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'agent_start' } })
    expect(service.list()[0].status).toBe('accepted')
  })
  it('recovers interrupted tasks as failed without replaying prompts', async () => {
    const { service, harnesses, git, file, input } = fixture()
    const task = await service.create(input)
    await service.start(task.id)
    const restored = new TaskService(file, harnesses, git)
    expect(restored.list()[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('interrupted') })
    expect(harnesses.pi.agents.command).toHaveBeenCalledTimes(1)
  })
  it('keeps two projects and engines isolated through concurrent execution and evidence reads', async () => {
    const { service, harnesses, input } = fixture()
    const pi = await service.create(input)
    const omp = await service.create({ ...input, harness: 'omp', projectId: 'omp', cwd: join(root, 'omp') })
    await Promise.all([service.start(pi.id), service.start(omp.id)])
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'agent_end' } })
    expect(service.list().find((task) => task.id === omp.id)?.status).toBe('running')
    const evidence = await service.evidence(pi.id)
    expect(evidence.messages[0].parts[0]).toMatchObject({ isError: true })
    expect(harnesses.pi.sessions.read).toHaveBeenCalledWith(join(root, 'pi.jsonl'))
    expect(harnesses.omp.sessions.read).not.toHaveBeenCalled()
  })
  it('rejects duplicate clicks and simultaneous tasks sharing a directory', async () => {
    const { service, harnesses, input } = fixture()
    const a = await service.create(input)
    const b = await service.create(input)
    const starts = await Promise.allSettled([service.start(a.id), service.start(a.id), service.start(b.id)])
    expect(starts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(harnesses.pi.agents.start).toHaveBeenCalledTimes(1)
  })
  it('returns while prompt acknowledgement is pending and records a later rejection', async () => {
    const { service, harnesses, input } = fixture()
    let reject!: (error: Error) => void
    harnesses.pi.agents.command.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const task = await service.create(input)
    expect((await service.start(task.id)).status).toBe('running')
    reject(new Error('provider unavailable'))
    await vi.waitFor(() => expect(service.list()[0].status).toBe('failed'))
    expect(harnesses.pi.agents.stop).toHaveBeenCalledWith('pi-runtime')
  })
  it('reports missing session evidence instead of returning empty records', async () => {
    const { service, harnesses, input } = fixture()
    const task = await service.create(input)
    await service.start(task.id)
    harnesses.pi.sessions.list.mockResolvedValue([])
    await expect(service.evidence(task.id)).rejects.toThrow('evidence cannot be loaded')
    expect(harnesses.pi.sessions.read).not.toHaveBeenCalled()
  })
  it('stops a runtime that reports a different model', async () => {
    const { service, harnesses, input } = fixture()
    const start = harnesses.pi.agents.start.getMockImplementation()!
    harnesses.pi.agents.start.mockImplementation(async (options) => ({ ...await start(options), model: { provider: 'other', id: 'model' } }))
    const task = await service.create(input)
    await expect(service.start(task.id)).rejects.toThrow('model does not match')
    expect(harnesses.pi.agents.command).not.toHaveBeenCalled()
    expect(harnesses.pi.agents.stop).toHaveBeenCalledWith('pi-runtime')
  })
  it('rejects revoked grants before starting or reading project evidence', async () => {
    const { service, harnesses, input } = fixture()
    const task = await service.create(input)
    harnesses.pi.projects.authorizeCwd.mockRejectedValue(new Error('grant revoked'))
    await expect(service.start(task.id)).rejects.toThrow('grant revoked')
    await expect(service.evidence(task.id)).rejects.toThrow('grant revoked')
    expect(harnesses.pi.agents.start).not.toHaveBeenCalled()
  })
  it('rejects foreign directories and mismatched project ownership', async () => {
    const { service, input } = fixture()
    await expect(service.create({ ...input, cwd: join(root, 'omp') })).rejects.toThrow('does not belong')
    await expect(service.create({ ...input, harness: 'omp' })).rejects.toThrow('explicitly added')
  })
  it('does not allow inferred or read-only projects', async () => {
    const { service, harnesses, input } = fixture()
    const [project] = await harnesses.pi.projects.list()
    harnesses.pi.projects.list.mockResolvedValue([{ ...project, inferred: true }])
    await expect(service.create(input)).rejects.toThrow('explicitly added')
    harnesses.pi.projects.list.mockResolvedValue([{ ...project, readOnly: true }])
    await expect(service.create(input)).rejects.toThrow('explicitly added')
  })
  it('reports provider errors and permits a revision before retry', async () => {
    const { service, harnesses, input } = fixture()
    const task = await service.create(input)
    harnesses.pi.agents.command.mockRejectedValueOnce(new Error('Provider unavailable'))
    await service.start(task.id)
    await vi.waitFor(() => expect(service.list()[0]).toMatchObject({ status: 'failed', error: 'Provider unavailable' }))
    expect(harnesses.pi.agents.stop).toHaveBeenCalledWith('pi-runtime')
    expect((await service.revise(task.id, 'Use the project conventions')).status).toBe('draft')
    await service.start(task.id)
    expect(harnesses.pi.agents.start).toHaveBeenLastCalledWith(expect.objectContaining({ sessionPath: join(root, 'pi.jsonl') }))
  })
  it('tracks questions and prevents failed completions becoming ready for review', async () => {
    const { service, input } = fixture()
    const task = await service.create(input)
    await service.start(task.id)
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'extension_ui_request', method: 'confirm' } })
    expect(service.list()[0].status).toBe('waiting')
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'message_end', message: { stopReason: 'error' } } })
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'agent_end' } })
    expect(service.list()[0].status).toBe('failed')
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'auto_retry_start' } })
    expect(service.list()[0].status).toBe('running')
    await service.stop(task.id)
    expect(service.list()[0].status).toBe('failed')
  })
  it('reports unexpected runtime exits and ignores unrelated events', async () => {
    const { service, input } = fixture()
    const task = await service.create(input)
    await service.start(task.id)
    service.onAgentEvent({ runtimeId: 'other-runtime', event: { type: 'agent_end' } })
    expect(service.list()[0].status).toBe('running')
    service.onAgentEvent({ runtimeId: 'pi-runtime', event: { type: 'runtime_exit', code: 1 } })
    expect(service.list()[0].status).toBe('failed')
  })
  it('rejects a mismatched runtime and stops it', async () => {
    const { service, input, harnesses } = fixture()
    const task = await service.create(input)
    harnesses.pi.agents.start.mockResolvedValueOnce({ runtimeId: 'wrong', harness: 'omp', cwd: input.cwd, isStreaming: false })
    await expect(service.start(task.id)).rejects.toThrow('does not match')
    expect(harnesses.pi.agents.command).not.toHaveBeenCalled()
    expect(harnesses.pi.agents.stop).toHaveBeenCalledWith('wrong')
  })
})

describe('task store and templates', () => {
  it('roundtrips templates and returns copies rather than mutable references', () => {
    const { service, harnesses, git, file } = fixture()
    const template = service.saveTemplate({ name: 'Bug fix', goal: 'Fix the bug', acceptance: 'Reproduce and verify' })
    service.templates()[0].name = 'mutated'
    const restored = new TaskService(file, harnesses, git)
    expect(restored.templates()[0]).toEqual(template)
    restored.deleteTemplate(template.id)
    expect(restored.templates()).toEqual([])
  })
  it('preserves corrupt data without disabling the rest of the app or overwriting it', () => {
    const { file, harnesses, git } = fixture()
    writeFileSync(file, '{invalid')
    const service = new TaskService(file, harnesses, git)
    expect(() => service.list()).toThrow('original file was preserved')
    expect(() => service.saveTemplate({ name: 'a', goal: 'b', acceptance: 'c' })).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{invalid')
  })
  it('validates untrusted inputs at the main process boundary', async () => {
    const { service, input } = fixture()
    for (const patch of [{ harness: 'prime' }, { goal: '' }, { acceptance: '\0' }, { title: 'x'.repeat(161) }, { thinking: 'ultra' }, { cloud: true }]) {
      await expect(service.create({ ...input, ...patch })).rejects.toThrow()
    }
    expect(() => service.saveTemplate({ name: '', goal: 'b', acceptance: 'c' })).toThrow()
  })
})
