import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Plus, Search } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { HarnessId, ProjectRecord, PtxApi } from '@/types/api'
import { TASK_STATUSES, type DevelopmentTask, type TaskStatus, type TaskTemplate } from '@/types/tasks'
import { TaskDetail } from './tasks/TaskDetail'
import { TaskForm } from './tasks/TaskForm'

export function TasksPage({ bridge, harness, onOpenSession }: { bridge: PtxApi | null; harness: HarnessId; onOpenSession(file: string, harness: HarnessId): void }) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<DevelopmentTask[]>([])
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [project, setProject] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const refreshing = useRef(false)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    if (!bridge) { setLoading(false); return }
    if (refreshing.current) return
    refreshing.current = true
    try {
      const [records, pi, omp, library] = await Promise.all([bridge.tasks.list(), bridge.projects.list('pi'), bridge.projects.list('omp'), bridge.tasks.templates()])
      if (!mounted.current) return
      setTasks((current) => JSON.stringify(current) === JSON.stringify(records) ? current : records)
      setProjects([...pi, ...omp]); setTemplates(library); setLoadError('')
    } catch (error) { if (mounted.current) setLoadError(error instanceof Error ? error.message : String(error)) }
    finally { refreshing.current = false; if (mounted.current) setLoading(false) }
  }, [bridge])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 3000)
    return () => { mounted.current = false; window.clearInterval(interval) }
  }, [refresh])
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await run(); await refresh() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { if (mounted.current) setBusy(false) }
  }
  const visible = tasks.filter((task) => (!status || task.status === status) && (!project || `${task.harness}:${task.projectId}` === project)
    && `${task.title} ${task.projectName} ${task.model}`.toLowerCase().includes(query.toLowerCase()))
  const selected = tasks.find((task) => task.id === selectedId)
  const projectOptions = [...new Map(tasks.map((task) => [`${task.harness}:${task.projectId}`, `${task.projectName} · ${task.harness === 'pi' ? 'Pi' : 'OMP'}`])).entries()]
  return <div className="page scroll-area"><div className="page-container task-page">
    <header className="page-header"><div><h1>{t('nav.tasks')}</h1><p>{t('tasks.subtitle')}</p></div><button type="button" className="button button--primary" disabled={!bridge || busy} onClick={() => { setCreating(true); setSelectedId(null) }}><Plus size={14} />{t('tasks.new')}</button></header>
    <p className="task-muted task-preview">{t('tasks.preview')}</p>
    {error || loadError ? <div className="task-error" role="alert">{error || loadError}<button className="button" type="button" disabled={busy} onClick={() => void refresh()}>{t('tasks.refresh')}</button></div> : null}
    {creating && bridge ? <TaskForm bridge={bridge} harness={harness} projects={projects} templates={templates} onCancel={() => setCreating(false)}
      onProjectCreated={(project) => setProjects((items) => [...items.filter((item) => item.id !== project.id || item.harness !== project.harness), project])}
      onDeleteTemplate={async (id) => { await bridge.tasks.deleteTemplate(id); await refresh() }}
      onCreate={async (input) => { const task = await bridge.tasks.create(input); setTasks((items) => [task, ...items]); setSelectedId(task.id); setCreating(false); await refresh() }} /> : <>
      <div className="task-filters"><label className="page-search"><Search size={14} /><input aria-label={t('tasks.search')} placeholder={t('tasks.search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label={t('tasks.all')} value={status} onChange={(event) => { if (event.target.value === '' || TASK_STATUSES.some((item) => item === event.target.value)) setStatus(event.target.value as TaskStatus | '') }}><option value="">{t('tasks.all')}</option>{TASK_STATUSES.map((item) => <option key={item} value={item}>{t(`tasks.${item}`)}</option>)}</select>
        <select aria-label={t('tasks.projects')} value={project} onChange={(event) => setProject(event.target.value)}><option value="">{t('tasks.projects')}</option>{projectOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </div>
      {loading ? <p role="status">{t('tasks.loading')}</p> : tasks.length === 0 ? <div className="empty-state"><CheckCircle2 size={26} /><h2>{t('tasks.empty')}</h2><p>{t('tasks.emptyHint')}</p></div> : <div className={`task-workspace${selected ? ' task-workspace--detail' : ''}`}>
        <div className="task-list" aria-label={t('nav.tasks')}>{!visible.length ? <p className="task-muted">{t('tasks.filtered')}</p> : visible.map((task) => <button className={`task-row${selectedId === task.id ? ' is-selected' : ''}`} type="button" key={task.id} onClick={() => setSelectedId(task.id)}><span className={`task-status task-status--${task.status}`}>{t(`tasks.${task.status}`)}</span><strong>{task.title}</strong><span>{task.projectName} · {task.harness === 'pi' ? 'Pi' : 'OMP'}</span></button>)}</div>
        {selected && bridge ? <TaskDetail key={selected.id} task={selected} bridge={bridge} busy={busy} onAction={action} onOpenSession={() => { if (selected.sessionFile) onOpenSession(selected.sessionFile, selected.harness) }} /> : null}
      </div>}
    </>}
  </div></div>
}
