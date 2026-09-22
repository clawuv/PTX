import type { AutomationScheduleRecord } from '@/types/api'

/**
 * Single source of truth for "needs attention" across the schedules page and
 * the sidebar badge: a blocked definition, or a latest run that failed or was
 * interrupted without a later success to clear it.
 */
export function scheduleNeedsAttention(item: AutomationScheduleRecord): boolean {
  const latest = item.runs.at(-1)
  return item.status === 'blocked' || latest?.status === 'failed' || latest?.status === 'interrupted'
}

export function countSchedulesNeedingAttention(items: AutomationScheduleRecord[]): number {
  return items.reduce((total, item) => total + (scheduleNeedsAttention(item) ? 1 : 0), 0)
}
