import { memo, useMemo } from 'react'
import { CalendarClock, Check, CircleDot, GitBranch, HeartPulse, LoaderCircle } from 'lucide-react'
import type { AutomationScheduleRecord, GitStatus, NativeHeartbeatRecord, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { useI18n } from '@/lib/i18n'
import { MarkdownText } from '../MarkdownText'

interface SummaryPanelProps {
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
  automations: AutomationScheduleRecord[]
  heartbeats: NativeHeartbeatRecord[]
  onOpenAutomation(id: string): void
}

export interface TranscriptSummary {
  toolCount: number
  lastText?: string
}

/** One pass for the tool count; one reverse walk that stops at the first text part. */
export function summarizeTranscript(messages: TranscriptMessage[]): TranscriptSummary {
  let toolCount = 0
  for (const message of messages) {
    for (const part of message.parts) if (part.type === 'toolCall') toolCount += 1
  }
  let lastText: string | undefined
  for (let index = messages.length - 1; index >= 0 && lastText === undefined; index -= 1) {
    const parts = messages[index].parts
    for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
      const part = parts[cursor]
      if (part.type === 'text') {
        lastText = part.text
        break
      }
    }
  }
  return { toolCount, lastText }
}

export const SummaryPanel = memo(function SummaryPanel({ agentName = 'Prime Agent', shortName = 'Prime', project, runtime, messages, git, automations, heartbeats, onOpenAutomation }: SummaryPanelProps) {
  const { t } = useI18n()
  const { toolCount, lastText } = useMemo(() => summarizeTranscript(messages), [messages])
  const active = Boolean(runtime?.isStreaming || runtime?.isCompacting)
  return (
    <div className="inspector-scroll scroll-area summary-panel">
      <section className="summary-hero">
        <span className={`run-state ${active ? 'is-running' : ''}`}>{active ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}{runtime?.isCompacting ? t('inspector.summary.state.compacting') : active ? t('inspector.summary.state.working', { name: shortName }) : t('inspector.summary.state.ready')}</span>
        <h2>{runtime?.isCompacting ? t('inspector.summary.hero.compacting') : active ? t('inspector.summary.hero.working') : t('inspector.summary.hero.overview')}</h2>
        <MarkdownText text={lastText !== undefined ? lastText.slice(0, 220) : t('inspector.summary.hero.fallback')} />
      </section>
      <section className="summary-section"><h3>{t('inspector.summary.workspace')}</h3><dl className="detail-list"><div><dt>{t('inspector.summary.project')}</dt><dd>{project?.name ?? t('inspector.summary.noProject')}</dd></div><div><dt>{t('inspector.summary.branch')}</dt><dd><GitBranch size={12} />{git.branch ?? project?.gitBranch ?? '—'}</dd></div><div><dt>{t('inspector.summary.environment')}</dt><dd>{t('inspector.summary.environment.value')}</dd></div><div><dt>{t('inspector.summary.cwd')}</dt><dd title={project?.primaryFolder} className="mono truncate">{project?.primaryFolder ?? '—'}</dd></div></dl></section>
      <section className="summary-section"><h3>{t('inspector.summary.progress')}</h3><div className="progress-list"><div><Check size={13} /><span>{t('inspector.summary.progress.loaded')}</span></div><div><Check size={13} /><span>{t('inspector.summary.progress.tools', { count: toolCount })}</span></div><div className={git.files.length ? 'is-current' : ''}><CircleDot size={13} /><span>{git.files.length ? t('inspector.summary.progress.files', { count: git.files.length }) : git.isRepo ? t('inspector.summary.progress.clean') : t('inspector.summary.progress.noGit')}</span></div></div></section>
      {automations.length || heartbeats.length ? <section className="summary-section"><h3>{t('inspector.summary.automations')}</h3><div className="summary-automation-list">
        {automations.slice(0, 2).map((task) => <button type="button" key={task.id} onClick={() => onOpenAutomation(task.id)}>
          <span className="summary-automation-icon"><CalendarClock size={14}/></span><span><strong>{task.title}</strong><small>{task.status}{task.nextRunAt ? t('inspector.summary.automation.next', { time: formatRelative(task.nextRunAt) }) : ''}</small></span>
        </button>)}
        {heartbeats.slice(0, Math.max(0, 2 - automations.length)).map((heartbeat) => <button type="button" key={heartbeat.id} onClick={() => onOpenAutomation(heartbeat.id)}>
          <span className="summary-automation-icon is-heartbeat"><HeartPulse size={14}/></span><span><strong>{heartbeat.label ?? (heartbeat.source === 'heartbeat' ? t('inspector.summary.heartbeat.thread') : t('inspector.summary.heartbeat.agent'))}</strong><small>{heartbeat.status}{heartbeat.nextRunAt ? t('inspector.summary.automation.next', { time: formatRelative(heartbeat.nextRunAt) }) : ''}</small></span>
        </button>)}
        {automations.length + heartbeats.length > 2 ? <button type="button" className="summary-automation-more" onClick={() => onOpenAutomation(automations[0]?.id ?? heartbeats[0]!.id)}>{t('inspector.summary.automations.viewAll', { count: automations.length + heartbeats.length })}</button> : null}
      </div></section> : null}
      <section className="summary-section"><h3>{t('inspector.summary.context')}</h3><div className="context-meter"><div><span>{t('inspector.summary.context.session')}</span><span>{t('inspector.summary.context.managed')}</span></div><small>{t('inspector.summary.context.note', { name: agentName })}</small></div></section>
    </div>
  )
})
