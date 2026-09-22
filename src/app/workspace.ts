import { errorMessage } from '@/lib/errors'
import type { MessageKey, MessageValues } from '@/lib/i18n'
import type { ProjectRecord, SessionRecord } from '@/types/api'

export interface WorkspaceSnapshot {
  generation: number
  project?: ProjectRecord
  session?: SessionRecord
  cwd?: string
  sessionFile?: string
}

type Translate = (key: MessageKey, values?: MessageValues) => string

export const requestFailureMessage = (error: unknown, t: Translate) => {
  const raw = errorMessage(error)
  const detail = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim()
  return detail ? t('hooks.requestFailed', { message: detail.slice(0, 1_000) }) : t('hooks.requestUnhandled')
}
