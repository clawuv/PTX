import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { GitDiff, PtxApi } from '@/types/api'
import type { DevelopmentTask, TaskEvidence } from '@/types/tasks'

export function TaskDetail({ task, bridge, busy, onAction, onOpenSession }: {
  task: DevelopmentTask; bridge: PtxApi; busy: boolean
  onAction(action: () => Promise<unknown>): Promise<void>; onOpenSession(): void
}) {
  const { t, locale } = useI18n()
  const [evidence, setEvidence] = useState<TaskEvidence | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState('')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [templateSaved, setTemplateSaved] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setDiff(null); setEvidence(null)
    void bridge.tasks.evidence(task.id).then((value) => { if (!cancelled) setEvidence(value) })
      .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bridge, task.id, task.updatedAt, refresh])
  const active = task.status === 'running' || task.status === 'waiting'
  const tools = evidence?.messages.flatMap((message) => message.parts.flatMap((part, index) =>
    part.type === 'toolCall' || part.type === 'toolResult' ? [{ key: `${message.id}:${index}`, part }] : [])) ?? []
  const response = evidence?.messages.filter((message) => message.role === 'assistant').at(-1)?.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  return <article className="task-detail" aria-label={task.title}>
    <header className="task-detail__header"><span className={`task-status task-status--${task.status}`}>{t(`tasks.${task.status}`)}</span><h2>{task.title}</h2><p>{task.projectName} · {task.harness === 'pi' ? 'Pi' : 'OMP'} · {task.model}</p><code>{task.cwd}</code></header>
    {task.error ? <p className="task-error" role="alert">{task.error}</p> : null}
    <div className="task-actions">
      {task.status === 'draft' || task.status === 'failed' ? <button className="button button--primary" disabled={busy} type="button" onClick={() => void onAction(() => bridge.tasks.start(task.id))}>{t(task.sessionFile ? 'tasks.retry' : 'tasks.start')}</button> : null}
      {active ? <button className="button" disabled={busy} type="button" onClick={() => void onAction(() => bridge.tasks.stop(task.id))}>{t('tasks.stop')}</button> : null}
      {task.sessionFile ? <button className="button" disabled={busy} type="button" onClick={onOpenSession}>{t('tasks.open')}</button> : null}
      {task.status === 'review' ? <button className="button button--primary" type="button" disabled={busy || loading || !evidence || Boolean(error)} onClick={() => void onAction(() => bridge.tasks.accept(task.id))}>{t('tasks.accept')}</button> : null}
      <button className="button" disabled={busy || templateSaved} type="button" onClick={() => void onAction(async () => {
        await bridge.tasks.saveTemplate({ name: task.title, goal: task.goal, acceptance: task.acceptance }); setTemplateSaved(true)
      })}>{t(templateSaved ? 'tasks.savedTemplate' : 'tasks.saveTemplate')}</button>
    </div>
    {active ? <p className="task-notice">{t('tasks.liveHint')}</p> : null}
    {task.status === 'review' ? <p className="task-notice">{t('tasks.reviewHint')}</p> : null}
    <section><h3>{t('tasks.goal')}</h3><p className="task-prose">{task.goal}</p><h3>{t('tasks.acceptance')}</h3><p className="task-prose">{task.acceptance}</p></section>
    {task.status === 'review' || task.status === 'failed' ? <form onSubmit={(event) => { event.preventDefault(); void onAction(async () => { await bridge.tasks.revise(task.id, revision); setRevision('') }) }}>
      <label>{t('tasks.revision')}<textarea rows={3} maxLength={16000} value={revision} onChange={(event) => setRevision(event.target.value)} required /></label>
      <button type="submit" className="button" disabled={busy || !revision.trim()}>{t('tasks.revise')}</button>
    </form> : null}
    <section><div className="task-section-heading"><h3>{t('tasks.changes')}</h3><button className="button" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t(loading ? 'tasks.loading' : 'tasks.refresh')}</button></div>
      <p className="task-muted">{t('tasks.changesHint')}</p>
      {error ? <p className="task-error" role="alert">{t('tasks.evidenceError')} {error}</p> : null}
      {evidence ? <>
        <p className="task-muted">{t('tasks.captured')} {new Date(evidence.capturedAt).toLocaleString(locale)}</p>
        {evidence.git.error ? <p className="task-error">{evidence.git.error}</p> : !evidence.git.isRepo ? <p>{t('tasks.notRepo')}</p> : evidence.git.files.length === 0 ? <p className="task-muted">{t('tasks.noChanges')}</p> : <ul className="task-files">{evidence.git.files.map((file) => <li key={`${file.path}:${file.staged}`}><button type="button" onClick={() => void onAction(async () => { setDiff(await bridge.git.diff(task.cwd, file.path, file.staged)) })}><code>{file.status}</code><span>{file.path}</span></button></li>)}</ul>}
        {evidence.git.truncated ? <p className="task-muted">…</p> : null}
        {diff ? <pre className="task-output">{diff.error ?? diff.text}{diff.truncated ? '\n…' : ''}</pre> : null}
      </> : null}
    </section>
    {response ? <section><h3>{t('tasks.result')}</h3><p className="task-prose">{response}</p></section> : null}
    <section><h3>{t('tasks.tools')}</h3><p className="task-muted">{t('tasks.toolsHint')}</p>
      {!tools.length ? <p className="task-muted">{t('tasks.noTools')}</p> : tools.map(({ key, part }) => <details className="task-tool" key={key}><summary>{part.name ?? t('tasks.result')} · {t(part.type === 'toolCall' ? 'tasks.call' : part.isError ? 'tasks.toolError' : 'tasks.toolRecorded')}</summary><pre className="task-output">{part.type === 'toolCall' ? JSON.stringify(part.args, null, 2) : part.text}</pre></details>)}
    </section>
    <section><h3>{t('tasks.history')}</h3><ol className="task-history">{task.history.map((entry, index) => <li key={`${entry.at}:${index}`}><time>{new Date(entry.at).toLocaleString(locale)}</time><span>{t(`tasks.${entry.status}`)}</span>{entry.note ? <p>{entry.note}</p> : null}</li>)}</ol></section>
  </article>
}
