import { describe, expect, it, vi } from 'vitest'
import { ScheduleRunNotifier, type ScheduleToast } from '../../electron/main/schedules/notifications'
import type { AutomationScheduleRecord, ScheduleRunOutcome, ScheduleRunRecord } from '../../src/types/api'

function task(overrides: Partial<AutomationScheduleRecord> = {}): AutomationScheduleRecord {
  return {
    schemaVersion: 1,
    id: 'task-1',
    harness: 'prime',
    revision: 1,
    title: 'Nightly triage',
    prompt: 'Review issues',
    target: { kind: 'project', projectId: 'project-1' },
    timing: { kind: 'once', at: '2030-01-02T09:00:00.000Z' },
    execution: { model: 'auto', thinking: 'auto', speed: 'normal' },
    status: 'active',
    createdBy: 'user',
    createdAt: '2030-01-01T09:00:00.000Z',
    updatedAt: '2030-01-01T09:00:00.000Z',
    runs: [],
    ...overrides,
  }
}

function run(overrides: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
  return {
    id: 'run-1',
    taskId: 'task-1',
    taskRevision: 1,
    trigger: 'scheduled',
    scheduledFor: '2030-01-02T09:00:00.000Z',
    queuedAt: '2030-01-02T09:00:00.000Z',
    status: 'succeeded',
    execution: { model: 'auto', thinking: 'auto', speed: 'normal' },
    ...overrides,
  }
}

function outcome(overrides: { task?: Partial<AutomationScheduleRecord>; run?: Partial<ScheduleRunRecord> } = {}): ScheduleRunOutcome {
  return { task: task(overrides.task), run: run(overrides.run) }
}

describe('ScheduleRunNotifier', () => {
  it('notifies on failed runs with a bounded single-line error excerpt', () => {
    const show = vi.fn<(toast: ScheduleToast) => void>()
    const notifier = new ScheduleRunNotifier({ show, maxErrorLength: 20 })
    notifier.onRunOutcome(
      outcome({
        run: { status: 'failed', error: 'provider exploded\n  with a very long multi-line message' },
      }),
    )
    expect(show).toHaveBeenCalledOnce()
    expect(show.mock.calls[0][0]).toMatchObject({
      taskId: 'task-1',
      runId: 'run-1',
      taskTitle: 'Nightly triage',
      error: 'provider exploded wi',
      blocked: false,
    })
  })

  it('stays silent while runs succeed, skip, or fail transiently mid-retry', () => {
    const show = vi.fn()
    const notifier = new ScheduleRunNotifier({ show })
    notifier.onRunOutcome(outcome({ run: { status: 'succeeded', sessionId: 's-1' } }))
    notifier.onRunOutcome(outcome({ run: { status: 'skipped', skippedCount: 2 } }))
    notifier.onRunOutcome(outcome({ run: { status: 'interrupted' } }))
    notifier.onRunOutcome(outcome({ run: { status: 'cancelled' } }))
    expect(show).not.toHaveBeenCalled()
  })

  it('reports the blocked reason when the circuit breaker just blocked the task', () => {
    const show = vi.fn<(toast: ScheduleToast) => void>()
    const notifier = new ScheduleRunNotifier({ show })
    notifier.onRunOutcome(
      outcome({
        task: { status: 'blocked', blockedReason: 'Ptx paused this task automatically after 3 consecutive failed runs. Last error: provider down' },
        run: { status: 'failed', error: 'provider down' },
      }),
    )
    expect(show).toHaveBeenCalledOnce()
    expect(show.mock.calls[0][0]).toMatchObject({
      blocked: true,
      error: expect.stringContaining('consecutive failed runs'),
    })
  })

  it('falls back to a generic error text when the run carries no error', () => {
    const show = vi.fn<(toast: ScheduleToast) => void>()
    const notifier = new ScheduleRunNotifier({ show })
    notifier.onRunOutcome(outcome({ run: { status: 'failed', error: undefined } }))
    expect(show.mock.calls[0][0].error).toBe('Unknown error')
  })
})
