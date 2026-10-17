import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { AgentModelDescriptor, AgentThinkingLevel, HarnessId, ProjectRecord, PtxApi } from '@/types/api'
import type { TaskInput, TaskTemplate } from '@/types/tasks'

export function TaskForm({ bridge, projects, templates, harness: initialHarness, onCreate, onCancel, onProjectCreated, onDeleteTemplate }: {
  bridge: PtxApi; projects: ProjectRecord[]; templates: TaskTemplate[]; harness: HarnessId
  onCreate(input: TaskInput): Promise<void>; onCancel(): void; onProjectCreated(project: ProjectRecord): void; onDeleteTemplate(id: string): Promise<void>
}) {
  const { t } = useI18n()
  const [harness, setHarness] = useState(initialHarness)
  const available = projects.filter((project) => project.harness === harness && !project.inferred && !project.readOnly)
  const [projectId, setProjectId] = useState('')
  const project = available.find((item) => item.id === projectId) ?? available[0]
  const [models, setModels] = useState<AgentModelDescriptor[]>([])
  const [model, setModel] = useState('')
  const [thinking, setThinking] = useState<AgentThinkingLevel | ''>('')
  const selectedModel = models.find((item) => item.key === model)
  const [cwd, setCwd] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [branch, setBranch] = useState('')
  const [worktree, setWorktree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const directories = project ? [...new Set([project.primaryFolder, ...project.folders])] : []
  const chosenCwd = directories.includes(cwd) ? cwd : project?.primaryFolder ?? ''
  useEffect(() => {
    let cancelled = false
    setModels([]); setModel(''); setThinking(''); setError('')
    void bridge.providers.catalog(false, harness).then((catalog) => {
      if (cancelled) return
      const available = catalog.models.filter((item) => item.available && item.enabled !== false)
      setModels(available)
      setModel(available[0]?.key ?? '')
    }).catch((error: unknown) => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true }
  }, [bridge, harness])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  return <form className="task-form" onSubmit={(event) => {
    event.preventDefault()
    if (!project || !model || busy) return
    void run(() => onCreate({ projectId: project.id, harness, cwd: chosenCwd, model, ...(thinking ? { thinking } : {}), title, goal, acceptance }))
  }}>
    <h2>{t('tasks.new')}</h2>
    {error ? <p className="task-error" role="alert">{error}</p> : null}
    <fieldset disabled={busy}>
      <div className="task-form__pair">
        <label>{t('tasks.engine')}<select value={harness} onChange={(event) => { setHarness(event.target.value as HarnessId); setProjectId(''); setCwd('') }}><option value="pi">Pi</option><option value="omp">OMP</option></select></label>
        <label>{t('tasks.project')}<select required value={project?.id ?? ''} onChange={(event) => { setProjectId(event.target.value); setCwd('') }}>{!available.length ? <option value="">{t('tasks.noProjects')}</option> : available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <label>{t('tasks.template')}<select value={templateId} onChange={(event) => {
        setTemplateId(event.target.value)
        const template = templates.find((item) => item.id === event.target.value)
        if (template) { setTitle(template.name); setGoal(template.goal); setAcceptance(template.acceptance) }
      }}><option value="">{t('tasks.noTemplate')}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {templateId ? <button type="button" className="button" onClick={() => void run(async () => { await onDeleteTemplate(templateId); setTemplateId('') })}>{t('tasks.deleteTemplate')}</button> : null}
      <label>{t('tasks.title')}<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{t('tasks.goal')}<textarea required maxLength={16000} rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
      <label>{t('tasks.acceptance')}<textarea required maxLength={16000} rows={3} value={acceptance} onChange={(event) => setAcceptance(event.target.value)} /></label>
      <label>{t('tasks.directory')}<select value={chosenCwd} onChange={(event) => setCwd(event.target.value)}>{directories.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
      <p className="task-muted">{t('tasks.directoryHint')}</p>
      <label className="task-form__checkbox"><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} />{t('tasks.worktree')}</label>
      {worktree ? <div className="task-form__worktree"><label>{t('tasks.branch')}<input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
        <button className="button" type="button" disabled={!project || !branch.trim()} onClick={() => void run(async () => {
          if (!project) return
          const created = await bridge.projects.createWorktree(chosenCwd, branch.trim(), harness)
          if (created) { onProjectCreated(created); setProjectId(created.id); setCwd(created.primaryFolder); setWorktree(false) }
        })}>{t('tasks.createWorktree')}</button><p className="task-muted">{t('tasks.worktreeHint')}</p></div> : null}
      <label>{t('tasks.model')}<select required value={model} onChange={(event) => { setModel(event.target.value); setThinking('') }}>{!models.length ? <option value="">{t('tasks.noModels')}</option> : models.map((item) => <option key={item.key} value={item.key}>{item.name} · {item.provider}/{item.id}</option>)}</select></label>
      {selectedModel?.availableThinkingLevels?.length ? <label>{t('tasks.strength')}<select value={thinking} onChange={(event) => setThinking(event.target.value as AgentThinkingLevel | '')}><option value="">{t('tasks.defaultStrength')}</option>{selectedModel.availableThinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label> : null}
      <div className="task-actions"><button type="button" className="button" onClick={onCancel}>{t('tasks.cancel')}</button><button type="submit" className="button button--primary" disabled={!project || !model || !title.trim() || !goal.trim() || !acceptance.trim() || worktree}>{busy ? t('tasks.loading') : t('tasks.create')}</button></div>
    </fieldset>
  </form>
}
