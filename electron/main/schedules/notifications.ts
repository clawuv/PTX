import type { ScheduleRunOutcome } from '../../../src/types/api'

/**
 * Structured, UI-string-free description of one OS notification. The host
 * formats localized text; bodies carry an error excerpt only — never the
 * full task prompt.
 */
export interface ScheduleToast {
  taskId: string
  runId: string
  taskTitle: string
  /** Trimmed run error, or the blocked reason when the task just got blocked. */
  error: string
  blocked: boolean
  sessionFile?: string
}

export interface ScheduleRunNotifierHost {
  /** Displays the toast; called only for outcomes worth interrupting the user. */
  show(toast: ScheduleToast): void
  /** Max characters of a run error kept in a notification body. */
  maxErrorLength?: number
}

const DEFAULT_MAX_ERROR_LENGTH = 280

function excerpt(error: string | undefined, max: number): string {
  return (error ?? 'Unknown error').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Notification policy for scheduled runs. Failures always notify because a
 * silent failure defeats the point of automation; successes stay silent
 * because the schedules page already reflects them live. A task the circuit
 * breaker just blocked reports its blocked reason so the required manual
 * intervention is obvious.
 */
export class ScheduleRunNotifier {
  private readonly maxErrorLength: number

  constructor(private readonly host: ScheduleRunNotifierHost) {
    this.maxErrorLength = host.maxErrorLength ?? DEFAULT_MAX_ERROR_LENGTH
  }

  onRunOutcome(outcome: ScheduleRunOutcome): void {
    if (outcome.run.status !== 'failed') return
    const blocked = outcome.task.status === 'blocked'
    this.host.show({
      taskId: outcome.task.id,
      runId: outcome.run.id,
      taskTitle: outcome.task.title,
      error: excerpt(blocked ? (outcome.task.blockedReason ?? outcome.run.error) : outcome.run.error, this.maxErrorLength),
      blocked,
      sessionFile: outcome.run.sessionFile,
    })
  }
}
