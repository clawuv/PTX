import { randomUUID } from 'node:crypto'
import { PRIME_THINKING_LEVELS } from '../../../src/types/api'
import type {
  PrimeThinkingLevel,
  ScheduleChangeEvent,
  ScheduleExecution,
  ScheduleInput,
  SchedulePatch,
  SchedulePreview,
  ScheduleRunOutcome,
  AutomationScheduleRecord, 
  ScheduleRunRecord,
  ScheduleTarget,
  ScheduleTiming,
  HarnessId,
} from '../../../src/types/api'
import type { JsonStateStore } from '../store'
import { rejectUnknownKeys, requireId, requireRecord, requireString } from '../validation'
import {
  countMissedOccurrences,
  nextScheduleOccurrence,
  previewScheduleOccurrences,
  validateScheduleTiming,
} from './recurrence'

const MAX_TASKS = 500
const MAX_CONCURRENT_RUNS = 2
const DUE_GRACE_MS = 60_000
/** Automatic re-dispatch attempts after the initial one (attempts 2 and 3). */
const MAX_AUTO_RETRIES = 2
const DEFAULT_RETRY_DELAYS_MS = [5 * 60_000, 20 * 60_000]
/** Consecutive terminal failures after which an active task is blocked automatically. */
const MAX_CONSECUTIVE_FAILURES = 3
const THINKING_LEVELS: ReadonlySet<string> = new Set(['auto', ...PRIME_THINKING_LEVELS])

export class ScheduleBlockedError extends Error {}

export interface ScheduleRunResult {
  sessionId?: string
  sessionFile?: string
}

export interface AutomationServiceOptions {
  validateTarget(target: ScheduleTarget, harness: HarnessId): Promise<void>
  validateExecution(execution: ScheduleExecution, harness: HarnessId): Promise<void>
  validatePrompt?(prompt: string, harness: HarnessId): void
  run(task: AutomationScheduleRecord): Promise<ScheduleRunResult>
  /** Invoked once per run when it reaches a terminal status; never mid-retry. */
  onRunOutcome?(outcome: ScheduleRunOutcome): void
  /** Backoff before retry attempts 2, 3, …; the last entry repeats. Test seam. */
  retryDelaysMs?: number[]
  now?: () => Date
}

function titleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Scheduled task'
}

function parseTarget(value: unknown): ScheduleTarget {
  const target = requireRecord(value, 'target')
  const kind = requireString(target.kind, 'target.kind', { min: 1, max: 16 })
  if (kind === 'project') {
    rejectUnknownKeys(target, ['kind', 'projectId'], 'target')
    return { kind, projectId: requireId(target.projectId, 'target.projectId') }
  }
  if (kind === 'session') {
    rejectUnknownKeys(target, ['kind', 'projectId', 'sessionId'], 'target')
    return { kind, projectId: requireId(target.projectId, 'target.projectId'), sessionId: requireId(target.sessionId, 'target.sessionId') }
  }
  throw new TypeError('Invalid schedule target')
}

function parseExecution(value: unknown): ScheduleExecution {
  const execution = requireRecord(value, 'execution')
  rejectUnknownKeys(execution, ['model', 'thinking', 'speed'], 'execution')
  const model = requireString(execution.model, 'execution.model', { min: 1, max: 512, trim: true })
  const thinking = requireString(execution.thinking, 'execution.thinking', { min: 1, max: 16, trim: true })
  if (!THINKING_LEVELS.has(thinking)) throw new TypeError('Invalid scheduled reasoning level')
  if (execution.speed !== 'normal' && execution.speed !== 'fast') throw new TypeError('Invalid scheduled speed')
  return { model, thinking: thinking as 'auto' | PrimeThinkingLevel, speed: execution.speed }
}

function parseTiming(value: unknown, now: Date): ScheduleTiming {
  const timing = requireRecord(value, 'timing')
  if (timing.kind === 'once') {
    rejectUnknownKeys(timing, ['kind', 'at'], 'timing')
    return validateScheduleTiming({ kind: 'once', at: requireString(timing.at, 'timing.at', { min: 1, max: 64, trim: true }) }, { now })
  }
  if (timing.kind === 'rrule') {
    rejectUnknownKeys(timing, ['kind', 'dtstartLocal', 'timeZone', 'rrule'], 'timing')
    return validateScheduleTiming({
      kind: 'rrule',
      dtstartLocal: requireString(timing.dtstartLocal, 'timing.dtstartLocal', { min: 1, max: 64, trim: true }),
      timeZone: requireString(timing.timeZone, 'timing.timeZone', { min: 1, max: 128, trim: true }),
      rrule: requireString(timing.rrule, 'timing.rrule', { min: 1, max: 2_048, trim: true }),
    }, { now })
  }
  throw new TypeError('Invalid schedule timing')
}

function parseInput(value: unknown, now: Date): Omit<ScheduleInput, 'createdBy'> {
  const input = requireRecord(value, 'schedule')
  rejectUnknownKeys(input, ['title', 'prompt', 'target', 'timing', 'execution'], 'schedule')
  const prompt = requireString(input.prompt, 'prompt', { min: 1, max: 1024 * 1024, trim: true })
  const title = input.title === undefined ? undefined : requireString(input.title, 'title', { min: 1, max: 200, trim: true })
  return { title, prompt, target: parseTarget(input.target), timing: parseTiming(input.timing, now), execution: parseExecution(input.execution) }
}

function parsePatch(value: unknown, now: Date): SchedulePatch {
  const patch = requireRecord(value, 'schedule patch')
  rejectUnknownKeys(patch, ['revision', 'title', 'prompt', 'target', 'timing', 'execution'], 'schedule patch')
  if (!Number.isSafeInteger(patch.revision) || Number(patch.revision) < 1) throw new TypeError('Invalid schedule revision')
  return {
    revision: Number(patch.revision),
    title: patch.title === undefined ? undefined : requireString(patch.title, 'title', { min: 1, max: 200, trim: true }),
    prompt: patch.prompt === undefined ? undefined : requireString(patch.prompt, 'prompt', { min: 1, max: 1024 * 1024, trim: true }),
    target: patch.target === undefined ? undefined : parseTarget(patch.target),
    timing: patch.timing === undefined ? undefined : parseTiming(patch.timing, now),
    execution: patch.execution === undefined ? undefined : parseExecution(patch.execution),
  }
}

function cloneTask(task: AutomationScheduleRecord): AutomationScheduleRecord { return structuredClone(task) }

export class AutomationService {
  private readonly listeners = new Set<(event: ScheduleChangeEvent) => void>()
  private readonly now: () => Date
  private timer: NodeJS.Timeout | null = null
  private closed = false
  private activeRuns = 0
  private readonly stopWaiters = new Set<() => void>()
  private readonly pending: Array<{ task: AutomationScheduleRecord; runId: string; attempt: number }> = []
  private readonly retryTimers = new Map<string, { taskId: string; timer: NodeJS.Timeout }>()
  private readonly retryDelaysMs: number[]

  constructor(private readonly store: JsonStateStore, private readonly options: AutomationServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.retryDelaysMs = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS
  }

  async start(): Promise<void> {
    this.closed = false
    await this.reconcileInterruptedRuns()
    await this.blockInvalidActivePrompts()
    await this.recoverMissed()
    this.armTimer()
  }

  private async blockInvalidActivePrompts(): Promise<void> {
    if (!this.options.validatePrompt) return
    const updatedAt = this.now().toISOString()
    await this.store.update((state) => {
      for (const task of state.schedules) {
        if (task.status !== 'active') continue
        try { this.options.validatePrompt!(task.prompt, task.harness) }
        catch (error) {
          if (!(error instanceof TypeError)) throw error
          task.status = 'blocked'
          task.blockedReason = error.message
          task.nextRunAt = undefined
          task.revision += 1
          task.updatedAt = updatedAt
        }
      }
    })
  }

  /**
   * Runs persisted as queued/running belong to a previous process; they will
   * never resume, so surface them as interrupted instead of forever-pending.
   * Automatic retry runs share this fate: a retry chain is best-effort within
   * one app session and the next scheduled occurrence is the recovery path.
   */
  private async reconcileInterruptedRuns(): Promise<void> {
    const finishedAt = this.now().toISOString()
    await this.store.update((state) => {
      for (const task of state.schedules) {
        for (const run of task.runs) {
          if (run.status !== 'queued' && run.status !== 'running') continue
          run.status = 'interrupted'
          run.finishedAt = finishedAt
          run.error = 'PiStudio quit before this run could finish.'
        }
      }
    })
  }

  async stop(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.clearRetryTimers()
    this.pending.splice(0)
    if (this.activeRuns === 0) return
    await new Promise<void>((resolveStop) => this.stopWaiters.add(resolveStop))
  }

  onDidChange(listener: (event: ScheduleChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasActiveSchedules(): boolean {
    return this.store.snapshot().schedules.some((task) => task.status === 'active')
  }

  list(harness?: HarnessId): AutomationScheduleRecord[] {
    return this.store.snapshot().schedules.filter((task) => harness === undefined || task.harness === harness).map(cloneTask).sort((left, right) => {
      const next = (left.nextRunAt ?? 'z').localeCompare(right.nextRunAt ?? 'z')
      return next || right.updatedAt.localeCompare(left.updatedAt)
    })
  }

  get(idValue: unknown): AutomationScheduleRecord {
    const id = requireId(idValue, 'schedule id')
    const task = this.store.snapshot().schedules.find((candidate) => candidate.id === id)
    if (!task) throw new Error('Scheduled task was not found')
    return cloneTask(task)
  }

  preview(timingValue: unknown, countValue: unknown = 3): SchedulePreview {
    const count = Number(countValue)
    if (!Number.isSafeInteger(count) || count < 1 || count > 10) throw new TypeError('Preview count must be between 1 and 10')
    const now = this.now()
    const timing = parseTiming(timingValue, now)
    return { timing, occurrences: previewScheduleOccurrences(timing, count, now) }
  }

  async create(inputValue: unknown, createdBy: 'user' | 'agent' = 'user', harness: HarnessId = 'prime'): Promise<AutomationScheduleRecord> {
    const now = this.now()
    const input = parseInput(inputValue, now)
    this.options.validatePrompt?.(input.prompt, harness)
    await Promise.all([this.options.validateTarget(input.target, harness), this.options.validateExecution(input.execution, harness)])
    const nextRunAt = nextScheduleOccurrence(input.timing, new Date(now.getTime() - 1))
    if (!nextRunAt) throw new TypeError('Schedule has no future occurrence')
    const task: AutomationScheduleRecord = {
      schemaVersion: 1,
      id: randomUUID(),
      harness,
      revision: 1,
      title: input.title ?? titleFromPrompt(input.prompt),
      prompt: input.prompt,
      target: input.target,
      timing: input.timing,
      execution: input.execution,
      status: 'active',
      createdBy,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt,
      runs: [],
    }
    await this.store.update((state) => {
      if (state.schedules.length >= MAX_TASKS) throw new Error(`PiStudio supports at most ${MAX_TASKS} scheduled tasks`)
      state.schedules.push(task)
    })
    this.changed({ taskId: task.id, reason: 'created' })
    this.armTimer()
    return cloneTask(task)
  }

  async update(idValue: unknown, patchValue: unknown): Promise<AutomationScheduleRecord> {
    const id = requireId(idValue, 'schedule id')
    const now = this.now()
    const patch = parsePatch(patchValue, now)
    const current = this.get(id)
    if (current.revision !== patch.revision) throw new Error('Scheduled task changed; reload it before saving')
    const target = patch.target ?? current.target
    const execution = patch.execution ?? current.execution
    const prompt = patch.prompt ?? current.prompt
    this.options.validatePrompt?.(prompt, current.harness)
    await Promise.all([this.options.validateTarget(target, current.harness), this.options.validateExecution(execution, current.harness)])
    const timing = patch.timing ?? current.timing
    const nextRunAt = nextScheduleOccurrence(timing, new Date(now.getTime() - 1))
    if (!nextRunAt) throw new TypeError('Schedule has no future occurrence')
    let updated!: AutomationScheduleRecord
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === id)
      if (!task) throw new Error('Scheduled task was not found')
      if (task.revision !== patch.revision) throw new Error('Scheduled task changed; reload it before saving')
      updated = {
        ...task,
        revision: task.revision + 1,
        title: patch.title ?? task.title,
        prompt,
        target,
        timing,
        execution,
        status: 'active',
        blockedReason: undefined,
        consecutiveFailures: undefined,
        updatedAt: now.toISOString(),
        nextRunAt,
      }
      Object.assign(task, updated)
    })
    this.changed({ taskId: id, reason: 'updated' })
    this.armTimer()
    return cloneTask(updated)
  }

  async pause(idValue: unknown): Promise<AutomationScheduleRecord> { return this.setStatus(idValue, 'paused') }

  async resume(idValue: unknown): Promise<AutomationScheduleRecord> {
    const id = requireId(idValue, 'schedule id')
    const now = this.now()
    const current = this.get(id)
    this.options.validatePrompt?.(current.prompt, current.harness)
    await Promise.all([this.options.validateTarget(current.target, current.harness), this.options.validateExecution(current.execution, current.harness)])
    const nextRunAt = nextScheduleOccurrence(current.timing, new Date(now.getTime() - 1))
    if (!nextRunAt) throw new Error('This schedule has no future occurrence')
    let updated!: AutomationScheduleRecord
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === id)
      if (!task) throw new Error('Scheduled task was not found')
      task.status = 'active'
      task.blockedReason = undefined
      task.consecutiveFailures = undefined
      task.nextRunAt = nextRunAt
      task.revision += 1
      task.updatedAt = now.toISOString()
      updated = cloneTask(task)
    })
    this.changed({ taskId: id, reason: 'updated' })
    this.armTimer()
    return updated
  }

  /**
   * Deleting a task cancels work that has not started. A run that already
   * crossed the persisted `running` transition is allowed to finish because
   * schedule executors do not expose a reliable cancellation primitive.
   */
  async delete(idValue: unknown): Promise<boolean> {
    const id = requireId(idValue, 'schedule id')
    const removed = await this.store.update((state) => {
      const index = state.schedules.findIndex((candidate) => candidate.id === id)
      if (index < 0) return false
      state.schedules.splice(index, 1)
      return true
    })
    if (removed) {
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        if (this.pending[index].task.id === id) this.pending.splice(index, 1)
      }
      this.clearRetryTimersForTask(id)
      this.changed({ taskId: id, reason: 'deleted' })
    }
    this.armTimer()
    return removed
  }

  async runNow(idValue: unknown): Promise<ScheduleRunRecord> {
    const task = this.get(idValue)
    this.options.validatePrompt?.(task.prompt, task.harness)
    await Promise.all([this.options.validateTarget(task.target, task.harness), this.options.validateExecution(task.execution, task.harness)])
    return this.enqueue(task, 'manual', this.now().toISOString())
  }

  private async setStatus(idValue: unknown, status: 'paused'): Promise<AutomationScheduleRecord> {
    const id = requireId(idValue, 'schedule id')
    const now = this.now().toISOString()
    let updated!: AutomationScheduleRecord
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === id)
      if (!task) throw new Error('Scheduled task was not found')
      task.status = status
      task.nextRunAt = undefined
      task.blockedReason = undefined
      task.revision += 1
      task.updatedAt = now
      updated = cloneTask(task)
    })
    this.changed({ taskId: id, reason: 'updated' })
    this.armTimer()
    return updated
  }

  private armTimer(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const next = this.store.snapshot().schedules
      .filter((task) => task.status === 'active' && task.nextRunAt)
      .map((task) => Date.parse(task.nextRunAt!))
      .filter(Number.isFinite)
      .reduce<number | undefined>((earliest, value) => earliest === undefined || value < earliest ? value : earliest, undefined)
    if (next === undefined) return
    const delay = Math.max(0, Math.min(2_147_483_647, next - this.now().getTime()))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.processDue()
        .catch((error) => console.error('Scheduled task processing failed:', error))
        .finally(() => this.armTimer())
    }, delay)
    this.timer.unref()
  }

  private async recoverMissed(): Promise<void> {
    const now = this.now()
    const snapshot = this.store.snapshot().schedules
    for (const task of snapshot) {
      if (task.status !== 'active' || !task.nextRunAt || Date.parse(task.nextRunAt) >= now.getTime() - DUE_GRACE_MS) continue
      await this.skipMissed(task, now)
    }
  }

  private async processDue(): Promise<void> {
    if (this.closed) return
    const now = this.now()
    const due = this.store.snapshot().schedules
      .filter((task) => task.status === 'active' && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime())
      .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!))
    for (const task of due) {
      if (now.getTime() - Date.parse(task.nextRunAt!) > DUE_GRACE_MS) await this.skipMissed(task, now)
      else await this.claimAndEnqueue(task, now)
    }
  }

  private async skipMissed(snapshot: AutomationScheduleRecord, now: Date): Promise<void> {
    const scheduledFor = snapshot.nextRunAt
    if (!scheduledFor) return
    const missed = countMissedOccurrences(snapshot.timing, new Date(scheduledFor), now, 10_000)
    const run: ScheduleRunRecord = {
      id: randomUUID(), taskId: snapshot.id, taskRevision: snapshot.revision, trigger: 'scheduled',
      scheduledFor, queuedAt: now.toISOString(), finishedAt: now.toISOString(), status: 'skipped',
      execution: snapshot.execution, skippedCount: Math.max(1, missed), error: 'PiStudio was not available when this task was due.',
    }
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === snapshot.id)
      if (task?.status !== 'active' || task.nextRunAt !== scheduledFor) return
      this.pushRun(task, run)
      const next = nextScheduleOccurrence(task.timing, now)
      if (next) task.nextRunAt = next
      else { task.nextRunAt = undefined; task.status = 'completed' }
      task.updatedAt = now.toISOString()
    })
    this.changed({ taskId: snapshot.id, reason: 'run' })
  }

  private async claimAndEnqueue(snapshot: AutomationScheduleRecord, now: Date): Promise<void> {
    const scheduledFor = snapshot.nextRunAt
    if (!scheduledFor) return
    let claimed: AutomationScheduleRecord | undefined
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === snapshot.id)
      if (task?.status !== 'active' || task.nextRunAt !== scheduledFor) return
      const next = nextScheduleOccurrence(task.timing, new Date(Date.parse(scheduledFor) + 1))
      if (next) task.nextRunAt = next
      else { task.nextRunAt = undefined; task.status = 'completed' }
      task.updatedAt = now.toISOString()
      claimed = cloneTask(task)
    })
    if (claimed) await this.enqueue(claimed, 'scheduled', scheduledFor)
  }

  private async enqueue(
    task: AutomationScheduleRecord,
    trigger: 'scheduled' | 'manual' | 'retry',
    scheduledFor: string,
    attempt = 1,
    retryOfRunId?: string,
  ): Promise<ScheduleRunRecord> {
    const now = this.now().toISOString()
    const run: ScheduleRunRecord = {
      id: randomUUID(), taskId: task.id, taskRevision: task.revision, trigger, scheduledFor,
      queuedAt: now, status: 'queued', execution: structuredClone(task.execution),
      attempt: attempt > 1 ? attempt : undefined, retryOfRunId,
    }
    await this.store.update((state) => {
      const current = state.schedules.find((candidate) => candidate.id === task.id)
      if (!current) throw new Error('Scheduled task was deleted before its run could start')
      this.pushRun(current, run)
    })
    this.pending.push({ task: cloneTask(task), runId: run.id, attempt })
    this.changed({ taskId: task.id, reason: 'run' })
    this.drain()
    return structuredClone(run)
  }

  private drain(): void {
    if (this.closed) return
    while (this.activeRuns < MAX_CONCURRENT_RUNS) {
      const item = this.pending.shift()
      if (!item) return
      this.activeRuns += 1
      void this.dispatch(item.task, item.runId, item.attempt).catch((error) => console.error('Scheduled run bookkeeping failed:', error)).finally(() => {
        this.activeRuns -= 1
        if (this.closed && this.activeRuns === 0) {
          for (const resolveStop of this.stopWaiters) resolveStop()
          this.stopWaiters.clear()
        }
        this.drain()
      })
    }
  }

  private async dispatch(task: AutomationScheduleRecord, runId: string, attempt: number): Promise<void> {
    const startedAt = this.now().toISOString()
    if (!await this.markRunStarted(task.id, runId, task.revision, startedAt)) {
      this.changed({ taskId: task.id, reason: 'run' })
      return
    }
    try {
      const result = await this.options.run(task)
      await this.recordSuccess(task.id, runId, result)
      this.emitOutcome(task.id, runId)
    } catch (reason) {
      // Policy-blocked errors are permanent configuration problems and are
      // never retried; every other failure is treated as transient and
      // re-dispatched with backoff until the retry budget is exhausted.
      const blocked = reason instanceof ScheduleBlockedError
      const error = reason instanceof Error ? reason.message.slice(0, 4_000) : String(reason).slice(0, 4_000)
      const retried = !blocked && await this.scheduleRetry(task, runId, attempt, error) !== undefined
      if (retried) {
        this.changed({ taskId: task.id, reason: 'run' })
        return
      }
      await this.recordTerminalFailure(task, runId, error, blocked)
      this.emitOutcome(task.id, runId)
    }
    this.changed({ taskId: task.id, reason: 'run' })
  }

  /**
   * Persists a queued retry run and arms its backoff timer. Returns the retry
   * run id, or undefined when the failure must stay terminal because the
   * retry budget is exhausted or the task was deleted mid-run.
   */
  private async scheduleRetry(task: AutomationScheduleRecord, failedRunId: string, attempt: number, error: string): Promise<string | undefined> {
    if (attempt > MAX_AUTO_RETRIES) return undefined
    const delayMs = attempt - 1 < this.retryDelaysMs.length
      ? this.retryDelaysMs[attempt - 1]
      : this.retryDelaysMs[this.retryDelaysMs.length - 1]
    const now = this.now().toISOString()
    const retryMinutes = Math.max(1, Math.round(delayMs / 60_000))
    const retryRun: ScheduleRunRecord = {
      id: randomUUID(), taskId: task.id, taskRevision: task.revision, trigger: 'retry',
      scheduledFor: new Date(Date.parse(now) + delayMs).toISOString(), queuedAt: now, status: 'queued',
      execution: structuredClone(task.execution), attempt: attempt + 1, retryOfRunId: failedRunId,
    }
    await this.updateRun(task.id, failedRunId, {
      status: 'failed', finishedAt: now,
      error: `${error} (retry ${attempt + 1} scheduled in ~${retryMinutes} min)`,
    })
    let persisted = false
    await this.store.update((state) => {
      const current = state.schedules.find((candidate) => candidate.id === task.id)
      if (!current) return
      this.pushRun(current, retryRun)
      persisted = true
    })
    if (!persisted) return undefined
    const timer = setTimeout(() => {
      this.retryTimers.delete(retryRun.id)
      if (this.closed) return
      const latest = this.store.snapshot().schedules.find((candidate) => candidate.id === task.id)
      if (!latest) return
      this.pending.push({ task: cloneTask(latest), runId: retryRun.id, attempt: attempt + 1 })
      this.drain()
    }, delayMs)
    timer.unref()
    this.retryTimers.set(retryRun.id, { taskId: task.id, timer })
    return retryRun.id
  }

  private async recordSuccess(taskId: string, runId: string, result: ScheduleRunResult): Promise<void> {
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (run) Object.assign(run, { status: 'succeeded', finishedAt: this.now().toISOString(), ...result })
      if (task) task.consecutiveFailures = undefined
    })
  }

  private async recordTerminalFailure(task: AutomationScheduleRecord, runId: string, error: string, blocked: boolean): Promise<void> {
    const finishedAt = this.now().toISOString()
    await this.store.update((state) => {
      const current = state.schedules.find((candidate) => candidate.id === task.id)
      if (!current) return
      const run = current.runs.find((candidate) => candidate.id === runId)
      if (run) Object.assign(run, { status: 'failed', finishedAt, error })
      if (blocked) {
        // A policy violation describes the definition it ran under; only block
        // when that definition is still current so a mid-run edit survives.
        if (current.revision !== task.revision) return
        current.status = 'blocked'
        current.blockedReason = error
        current.nextRunAt = undefined
        current.updatedAt = finishedAt
        return
      }
      current.consecutiveFailures = (current.consecutiveFailures ?? 0) + 1
      if (current.consecutiveFailures < MAX_CONSECUTIVE_FAILURES || current.status !== 'active') return
      current.status = 'blocked'
      current.blockedReason = `PiStudio paused this task automatically after ${MAX_CONSECUTIVE_FAILURES} consecutive failed runs. Last error: ${error}`
      current.nextRunAt = undefined
      current.updatedAt = finishedAt
    })
  }

  private emitOutcome(taskId: string, runId: string): void {
    if (!this.options.onRunOutcome) return
    const task = this.store.snapshot().schedules.find((candidate) => candidate.id === taskId)
    const run = task?.runs.find((candidate) => candidate.id === runId)
    if (!task || !run || (run.status !== 'succeeded' && run.status !== 'failed')) return
    try {
      this.options.onRunOutcome({ task: cloneTask(task), run: structuredClone(run) })
    } catch (error) {
      console.error('Scheduled run outcome listener failed:', error)
    }
  }

  private clearRetryTimers(): void {
    for (const entry of this.retryTimers.values()) clearTimeout(entry.timer)
    this.retryTimers.clear()
  }

  private clearRetryTimersForTask(taskId: string): void {
    for (const [runId, entry] of this.retryTimers) {
      if (entry.taskId !== taskId) continue
      clearTimeout(entry.timer)
      this.retryTimers.delete(runId)
    }
  }

  private async markRunStarted(taskId: string, runId: string, expectedRevision: number, startedAt: string): Promise<boolean> {
    return this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === taskId)
      if (!task) return false
      const run = task.runs.find((candidate) => candidate.id === runId)
      if (run?.status !== 'queued') return false
      if (run.taskRevision !== expectedRevision || task.revision !== expectedRevision) {
        Object.assign(run, {
          status: 'cancelled', finishedAt: startedAt,
          error: 'Scheduled task changed before this queued run could start.',
        })
        return false
      }
      Object.assign(run, { status: 'running', startedAt })
      return true
    })
  }

  private async updateRun(taskId: string, runId: string, patch: Partial<ScheduleRunRecord>): Promise<void> {
    await this.store.update((state) => {
      const task = state.schedules.find((candidate) => candidate.id === taskId)
      const run = task?.runs.find((candidate) => candidate.id === runId)
      if (run) Object.assign(run, patch)
    })
  }

  private pushRun(task: AutomationScheduleRecord, run: ScheduleRunRecord): void {
    task.runs.push(structuredClone(run))
  }

  private changed(event: ScheduleChangeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
