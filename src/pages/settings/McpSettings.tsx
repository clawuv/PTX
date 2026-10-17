import { Globe2, Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { HarnessId, McpConnectionInput, ProjectRecord, SkillRecord } from '@/types/api'

const ENGINES = [
  { id: 'pi', name: 'Pi' },
  { id: 'omp', name: 'OMP' },
] as const
type Scope = 'user' | 'project'

export function McpSettings({ initialHarness, projects }: { initialHarness: HarnessId; projects: ProjectRecord[] }) {
  const { t } = useI18n()
  const [harness, setHarness] = useState<HarnessId>(initialHarness === 'omp' ? 'omp' : 'pi')
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [alert, setAlert] = useState('')
  const [notice, setNotice] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<SkillRecord | null>(null)
  const [form, setForm] = useState({ name: '', command: '', args: '', scope: 'user' as Scope, projectId: '' })

  const granted = projects.filter((project) => project.harness === harness && !project.inferred && !project.readOnly)
  const filterPath = granted.find((project) => project.id === projectId)?.primaryFolder
  const adapter = skills.find((skill) => skill.id === 'ptx-pi-mcp')
  const adapterInstalled = Boolean(adapter?.enabled)
  const servers = skills.filter((skill) => skill.kind === 'mcp')

  useEffect(() => {
    setProjectId('')
    setForm((current) => ({ ...current, projectId: '' }))
  }, [harness])

  useEffect(() => {
    let live = true
    setLoading(true)
    void window.ptx.plugins
      .list(filterPath, harness)
      .then((catalog) => {
        if (!live) return
        setSkills(catalog.skills)
        setAlert('')
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!live) return
        setAlert(errorMessage(error))
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [filterPath, harness])

  const scopeOf = (skill: SkillRecord): Scope => (skill.location === 'project' ? 'project' : 'user')
  const run = async (id: string, work: () => Promise<{ ok: boolean; output: string }>): Promise<boolean> => {
    setBusy(id)
    setAlert('')
    setNotice('')
    try {
      const response = await work()
      if (!response.ok) setAlert(response.output)
      else setSkills((await window.ptx.plugins.list(filterPath, harness)).skills)
      return response.ok
    } catch (error) {
      setAlert(errorMessage(error))
      return false
    } finally {
      setBusy('')
    }
  }
  const setEnabled = (skill: SkillRecord, enabled: boolean) => {
    const scope = scopeOf(skill)
    void run(skill.id, () => window.ptx.plugins.setMcpEnabled({ name: skill.name, scope, projectPath: scope === 'project' ? filterPath : undefined, enabled }, harness))
  }
  const remove = (skill: SkillRecord) => {
    if (!window.confirm(t('settings.mcp.removeConfirm', { name: skill.name }))) return
    const scope = scopeOf(skill)
    void run(skill.id, () =>
      window.ptx.plugins.mutateCapability(
        {
          kind: 'mcp',
          action: 'remove',
          name: skill.name,
          scope,
          projectPath: scope === 'project' ? filterPath : undefined,
          ...(skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
        },
        harness,
      ),
    )
  }
  const setAdapter = (enabled: boolean) => {
    void run('ptx-pi-mcp', () => window.ptx.plugins.setMcpSupport(enabled, harness)).then((ok) => {
      if (ok) setNotice(enabled ? t('plugins.adapterInstalled') : t('plugins.adapterDisabled'))
    })
  }
  const dialogScope: Scope = editing ? scopeOf(editing) : form.scope
  const canSave = Boolean(form.name.trim() && form.command.trim() && (dialogScope !== 'project' || (editing ? filterPath : form.projectId)))
  const resetDialog = () => {
    setAddOpen(false)
    setEditing(null)
    setForm({ name: '', command: '', args: '', scope: 'user', projectId: '' })
  }
  const openAdd = () => {
    setAlert('')
    resetDialog()
    setAddOpen(true)
  }
  const openEdit = (skill: SkillRecord) => {
    setAlert('')
    setForm({
      name: skill.definitionKey ?? skill.name,
      command: skill.mcpDefinition?.command ?? '',
      args: skill.mcpDefinition?.args?.join('\n') ?? '',
      scope: scopeOf(skill),
      projectId: scopeOf(skill) === 'project' ? projectId : '',
    })
    setEditing(skill)
    setAddOpen(true)
  }
  const saveConnection = () => {
    const scope = dialogScope
    const project = granted.find((item) => item.id === form.projectId)
    const connection: McpConnectionInput = {
      name: form.name.trim(),
      scope,
      projectPath: scope === 'project' ? (editing ? filterPath : project?.primaryFolder) : undefined,
      type: 'stdio',
      command: form.command.trim(),
      args: form.args
        .split('\n')
        .map((arg) => arg.trim())
        .filter(Boolean),
      ...(editing?.definitionKey ? { previousKey: editing.definitionKey } : {}),
    }
    const updated = Boolean(editing)
    void run('add', () => window.ptx.plugins.connectMcp(connection, harness)).then((ok) => {
      if (!ok) return
      setAddOpen(false)
      setEditing(null)
      setForm({ name: '', command: '', args: '', scope, projectId: scope === 'project' ? form.projectId : '' })
      if (!updated && scope === 'project' && form.projectId) setProjectId(form.projectId)
      setNotice(t(updated ? 'settings.mcp.updated' : 'settings.mcp.added'))
    })
  }
  const rowBlocked = (skill: SkillRecord): string | undefined => {
    if (skill.availability?.available === false) return skill.availability.detail
    if (harness === 'pi' && !adapterInstalled) return t('plugins.adapterRequiredDetail')
    return undefined
  }

  return (
    <section className="mcp-settings">
      <header>
        <div>
          <h1>{t('settings.mcp')}</h1>
          <p>{t('settings.mcp.description')}</p>
        </div>
        <button type="button" className="button button--primary" onClick={openAdd}>
          <Plus size={14} />
          {t('settings.mcp.add.submit')}
        </button>
      </header>
      <div className="settings-group">
        <div className="mcp-fields">
          <label className="field">
            <span>{t('settings.mcp.engine')}</span>
            <select
              value={harness}
              onChange={(event) => {
                if (event.target.value === 'pi' || event.target.value === 'omp') setHarness(event.target.value)
              }}
            >
              {ENGINES.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('settings.mcp.scope')}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">{t('settings.mcp.scope.user')}</option>
              {granted.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {harness === 'pi' && adapter ? (
          <div className="mcp-adapter">
            <div>
              <strong>{t('settings.mcp.adapter.title')}</strong>
              <p>{t('settings.mcp.adapter.description')}</p>
            </div>
            <button type="button" className={adapterInstalled ? 'button' : 'button button--primary'} disabled={busy === 'ptx-pi-mcp'} onClick={() => setAdapter(!adapterInstalled)}>
              {adapterInstalled ? t('settings.mcp.adapter.remove') : t('settings.mcp.adapter.install')}
            </button>
          </div>
        ) : null}
        <h2>{t('settings.mcp.list')}</h2>
        {loading ? <p className="settings-note">{t('settings.mcp.loading')}</p> : null}
        {!loading && !servers.length ? <p className="settings-note">{t('settings.mcp.empty')}</p> : null}
        <ul className="mcp-list">
          {servers.map((skill) => {
            const blocked = rowBlocked(skill)
            return (
              <li className="mcp-row" key={skill.id}>
                <span className="mcp-row__icon">
                  <Globe2 size={14} />
                </span>
                <div className="mcp-row__main">
                  <strong>{skill.name}</strong>
                  <small>
                    {skill.source}
                    {skill.location === 'project' ? ` · ${t('settings.mcp.location.project')}` : ''}
                  </small>
                  {blocked ? <small className="mcp-row__detail">{blocked}</small> : null}
                </div>
                {blocked ? (
                  <span className="mcp-row__shield" title={blocked}>
                    <ShieldCheck size={14} />
                  </span>
                ) : (
                  <div className="mcp-row__actions">
                    <button type="button" className={skill.enabled ? 'button' : 'button button--primary'} disabled={Boolean(busy)} onClick={() => setEnabled(skill, !skill.enabled)}>
                      {skill.enabled ? t('settings.mcp.disable') : t('settings.mcp.enable')}
                    </button>
                    {skill.definitionRemovalAvailable !== false ? (
                      <button type="button" className="button" disabled={Boolean(busy)} onClick={() => openEdit(skill)}>
                        {t('settings.mcp.edit')}
                      </button>
                    ) : null}
                    {skill.definitionRemovalAvailable !== false ? (
                      <button type="button" className="button mcp-remove" disabled={Boolean(busy)} onClick={() => remove(skill)}>
                        {t('settings.mcp.remove')}
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {notice ? (
          <p className="settings-note" role="status">
            {notice}
          </p>
        ) : null}
        {alert && !addOpen ? (
          <p className="settings-error" role="alert">
            {alert}
          </p>
        ) : null}
      </div>
      {addOpen ? (
        <Modal title={t(editing ? 'settings.mcp.editServer' : 'settings.mcp.add')} onClose={resetDialog}>
          <p className="settings-note">
            {t(harness === 'pi' ? 'plugins.mcpIntro.pi' : 'plugins.mcpIntro.omp')} {t('plugins.mcpTrustWarning')}
          </p>
          <div className="mcp-fields">
            <label className="field">
              <span>{t('settings.mcp.add.name')}</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('settings.mcp.add.command')}</span>
              <input value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} />
            </label>
            <label className="field mcp-fields__wide">
              <span>{t('settings.mcp.add.args')}</span>
              <textarea value={form.args} rows={3} onChange={(event) => setForm({ ...form, args: event.target.value })} />
            </label>
            {!editing && form.scope === 'project' ? (
              <label className="field">
                <span>{t('settings.mcp.scope.project')}</span>
                <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
                  <option value="">{t('settings.mcp.project.placeholder')}</option>
                  {granted.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="mcp-actions">
            {editing ? (
              <span className="mcp-actions__scope">{t(dialogScope === 'project' ? 'settings.mcp.scope.project' : 'settings.mcp.scope.user')}</span>
            ) : (
              <>
                <button type="button" className="button" disabled={form.scope === 'user'} onClick={() => setForm({ ...form, scope: 'user' })}>
                  {t('settings.mcp.scope.user')}
                </button>
                <button type="button" className="button" disabled={form.scope === 'project'} onClick={() => setForm({ ...form, scope: 'project' })}>
                  {t('settings.mcp.scope.project')}
                </button>
              </>
            )}
            <button type="button" className="button button--primary" disabled={!canSave || Boolean(busy)} onClick={saveConnection}>
              <Plus size={14} />
              {t(editing ? 'settings.mcp.edit.submit' : 'settings.mcp.add.submit')}
            </button>
          </div>
          {alert ? (
            <p className="settings-error" role="alert">
              {alert}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </section>
  )
}
