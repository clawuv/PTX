import { AlertTriangle, ArrowLeft, BookOpen, Check, ChevronRight, FileCode2, FileText, GitFork, Globe2, Package, Palette, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CapabilityMutationInput, ExtensionInstallInput, HarnessId, McpConnectionInput, McpStateInput, PluginWarning, SkillRecord } from '@/types/api'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { NETWORK_MCP_UNAVAILABLE_DETAIL } from '@/lib/mcp-policy'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { EmptyState, Modal, SelectMenu } from '@/components/ui'

const MCP_STDIO_HELP: Record<HarnessId, MessageKey> = {
  omp: 'plugins.mcpHelp.omp',
  pi: 'plugins.mcpHelp.pi',
}

type DirectoryTab = 'plugins' | 'skills'
type AddKind = 'mcp' | 'bundle' | 'extension'
type McpScope = 'user' | 'project'

const PACKAGE_LABELS: Record<HarnessId, MessageKey> = { omp: 'plugins.packageLabel.omp', pi: 'plugins.packageLabel.pi' }
const PACKAGE_HELP: Record<HarnessId, MessageKey> = {
  omp: 'plugins.packageHelp.omp',
  pi: 'plugins.packageHelp.pi',
}
const GITHUB_ISSUES_URL = 'https://github.com/clawuv/PTX/issues/new'

function capabilityDetailId(skill: SkillRecord): string {
  return `capability-detail-${skill.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128)}`
}

function SkillIcon({ skill }: { skill: SkillRecord }) {
  const common = { size: 16 }
  if (skill.icon === 'github') return <GitFork {...common}/>
  if (skill.icon === 'palette') return <Palette {...common}/>
  if (skill.icon === 'book-open') return <BookOpen {...common}/>
  if (skill.kind === 'mcp') return <Globe2 {...common}/>
  if (skill.kind === 'prompt') return <FileText {...common}/>
  if (skill.kind === 'skill') return <WandSparkles {...common}/>
  return <Package {...common}/>
}

interface PluginsPageProps {
  harness: HarnessId
  skills: SkillRecord[]
  warnings: PluginWarning[]
  loading: boolean
  activeProjectPath?: string
  onRefresh(): Promise<void>
  askUserEnabled: boolean
  onSetAskUserEnabled(enabled: boolean): Promise<void>
  browserEnabled: boolean
  onSetBrowserEnabled(enabled: boolean): Promise<void>
  computerUseEnabled: boolean
  onSetComputerUseEnabled(enabled: boolean): Promise<void>
  onOpenExternal(url: string): void
  onInstall(source: string): Promise<{ ok: boolean; output: string }>
  onInstallExtension(input: ExtensionInstallInput): Promise<{ ok: boolean; output: string }>
  onSetMcpSupport(enabled: boolean): Promise<{ ok: boolean; output: string }>
  onConnectMcp(input: McpConnectionInput): Promise<{ ok: boolean; output: string }>
  onSetMcpEnabled(input: McpStateInput): Promise<{ ok: boolean; output: string }>
  onMutateCapability?(input: CapabilityMutationInput): Promise<{ ok: boolean; output: string }>
  openAddSignal?: number
  showHeaderAction?: boolean
}

export function PluginsPage({ harness, skills, warnings, loading, activeProjectPath, askUserEnabled, onSetAskUserEnabled, browserEnabled, onSetBrowserEnabled, computerUseEnabled, onSetComputerUseEnabled, onOpenExternal, onRefresh, onInstall, onInstallExtension, onSetMcpSupport, onConnectMcp, onSetMcpEnabled, onMutateCapability, openAddSignal = 0, showHeaderAction = true }: PluginsPageProps) {
  const { t } = useI18n()
  const mutateCapability = onMutateCapability ?? (async () => ({ ok: false, output: t('plugins.capabilityChangesUnavailable') }))
  const [tab, setTab] = useState<DirectoryTab>('plugins')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<AddKind | null>(null)
  const [source, setSource] = useState('')
  const [mcpName, setMcpName] = useState('')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpScope, setMcpScope] = useState<McpScope>('user')
  const [result, setResult] = useState('')
  const [adding, setAdding] = useState(false)
  const [askUserUpdating, setAskUserUpdating] = useState(false)
  const [browserUpdating, setBrowserUpdating] = useState(false)
  const [computerUseUpdating, setComputerUseUpdating] = useState(false)
  const [computerUseAlert, setComputerUseAlert] = useState('')
  const [mcpSupportUpdating, setMcpSupportUpdating] = useState(false)
  const [mcpSupportAlert, setMcpSupportAlert] = useState('')
  const [mcpSupportNotice, setMcpSupportNotice] = useState('')
  const [capabilityUpdating, setCapabilityUpdating] = useState('')
  const lastOpenAddSignal = useRef(openAddSignal)
  const [confirmDisable, setConfirmDisable] = useState<SkillRecord | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<SkillRecord | null>(null)
  const [capabilityAlert, setCapabilityAlert] = useState('')
  const piMcpAdapterInstalled = skills.some((skill) => skill.id === 'ptx-pi-mcp' && skill.enabled)
  const canConfigureMcp = harness === 'omp' || harness === 'pi' && piMcpAdapterInstalled

  const visible = useMemo(() => skills.map((skill) => skill.id === 'ptx-ask-user'
    ? { ...skill, enabled: askUserEnabled }
    : skill.id === 'omp-work-browser' ? { ...skill, enabled: browserEnabled }
    : skill.id === 'ptx-computer-use' ? { ...skill, enabled: computerUseEnabled } : skill).filter((skill) => {
    const capability = skill.id === 'omp-work-browser' || skill.kind !== 'skill' && skill.kind !== 'prompt'
    return (tab === 'plugins' ? capability : !capability)
      && (filter === 'all' || filter === 'installed' && skill.enabled || filter === skill.location)
      && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())
  }), [askUserEnabled, browserEnabled, computerUseEnabled, skills, tab, filter, query])

  const canAdd = addKind === 'bundle'
    ? Boolean(source.trim())
    : addKind === 'extension'
      ? Boolean(source.trim() && (mcpScope !== 'project' || activeProjectPath))
    : addKind === 'mcp' && canConfigureMcp && Boolean(
      mcpName.trim()
      && mcpCommand.trim()
      && (mcpScope !== 'project' || activeProjectPath),
    )

  const add = async () => {
    if (!canAdd) return
    setAdding(true)
    setResult('')
    try {
      const response = addKind === 'bundle'
        ? await onInstall(source.trim())
        : addKind === 'extension'
          ? await onInstallExtension({ source: source.trim(), scope: mcpScope, projectPath: mcpScope === 'project' ? activeProjectPath : undefined })
          : await onConnectMcp({ name: mcpName.trim(), scope: mcpScope, projectPath: mcpScope === 'project' ? activeProjectPath : undefined, type: 'stdio', command: mcpCommand.trim(), args: mcpArgs.split('\n').map((arg) => arg.trim()).filter(Boolean) })
      setResult(response.output)
      if (response.ok) {
        setSource('')
        setMcpName('')
        setMcpCommand('')
        setMcpArgs('')
        if (addKind === 'mcp' || addKind === 'bundle') await onRefresh()
      }
    } finally {
      setAdding(false)
    }
  }

  const selectAddKind = (value: AddKind | null) => { setAddKind(value); setSource(''); setResult('') }
  const openAdd = () => { setResult(''); setAddKind(null); setAddOpen(true) }
  useEffect(() => {
    if (openAddSignal === lastOpenAddSignal.current) return
    lastOpenAddSignal.current = openAddSignal
    openAdd()
  }, [openAddSignal])
  const setAskUser = async (enabled: boolean) => {
    if (askUserUpdating) return
    setAskUserUpdating(true)
    try {
      await onSetAskUserEnabled(enabled)
      await onRefresh()
    } finally {
      setAskUserUpdating(false)
    }
  }
  const setBrowser = async (enabled: boolean) => {
    if (browserUpdating) return
    setBrowserUpdating(true)
    try {
      await onSetBrowserEnabled(enabled)
      await onRefresh()
    } finally {
      setBrowserUpdating(false)
    }
  }
  const setComputerUse = async (skill: SkillRecord, enabled: boolean) => {
    if (computerUseUpdating) return
    if (enabled && skill.availability?.available === false) {
      setComputerUseAlert(skill.availability.detail)
      if (skill.availability.actionUrl) onOpenExternal(skill.availability.actionUrl)
      return
    }
    setComputerUseAlert('')
    setComputerUseUpdating(true)
    try {
      await onSetComputerUseEnabled(enabled)
      await onRefresh()
    } finally {
      setComputerUseUpdating(false)
    }
  }
  const setMcpSupport = async (_skill: SkillRecord, enabling: boolean) => {
    if (mcpSupportUpdating) return
    setMcpSupportUpdating(true)
    setMcpSupportAlert('')
    setMcpSupportNotice(enabling ? t('plugins.adapterInstalling') : t('plugins.adapterDisabling'))
    try {
      const response = await onSetMcpSupport(enabling)
      if (!response.ok) {
        const busy = /lock file is already being held|settings are busy/i.test(response.output)
        setMcpSupportAlert(busy ? t('plugins.mcpBusy') : response.output)
        setMcpSupportNotice('')
      } else {
        setMcpSupportNotice(enabling ? t('plugins.adapterInstalled') : t('plugins.adapterDisabled'))
      }
    } finally {
      setMcpSupportUpdating(false)
    }
  }
  const mcpServerName = (skill: SkillRecord): string => skill.name
  const setMcp = async (skill: SkillRecord, enabled: boolean) => {
    if (capabilityUpdating) return
    setCapabilityUpdating(skill.id)
    setCapabilityAlert('')
    try {
      const response = await onSetMcpEnabled({ name: skill.name, scope: skill.location === 'project' ? 'project' : 'user', projectPath: skill.location === 'project' ? activeProjectPath : undefined, enabled })
      if (!response.ok) setCapabilityAlert(response.output)
    } finally {
      setCapabilityUpdating('')
    }
  }
  const disableCapability = async (skill: SkillRecord) => {
    setConfirmDisable(null)
    if (skill.id === 'ptx-ask-user') await setAskUser(false)
    else if (skill.id === 'omp-work-browser') await setBrowser(false)
    else if (skill.id === 'ptx-computer-use') await setComputerUse(skill, false)
    else if (skill.id === 'ptx-pi-mcp') await setMcpSupport(skill, false)
    else if (skill.kind === 'mcp') await setMcp(skill, false)
    else if (skill.kind === 'package') await mutate(skill, 'disable')
  }
  const mutate = async (skill: SkillRecord, action: CapabilityMutationInput['action']) => {
    setCapabilityUpdating(skill.id)
    setCapabilityAlert('')
    try {
      const response = await mutateCapability({
        kind: skill.kind === 'mcp' ? 'mcp' : 'package',
        action,
        name: skill.kind === 'mcp' ? mcpServerName(skill) : skill.name,
        ...(skill.kind === 'mcp' && action === 'remove' && skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
        ...(skill.kind === 'package' ? { source: skill.source } : {}),
        scope: skill.location === 'project' ? 'project' : 'user',
        projectPath: skill.location === 'project' ? activeProjectPath : undefined,
      })
      if (!response.ok) setCapabilityAlert(response.output)
    } finally {
      setCapabilityUpdating('')
    }
  }
  const removeCapability = async (skill: SkillRecord) => {
    setConfirmRemove(null)
    await mutate(skill, 'remove')
  }
  const mcpStatusDetail = (skill: SkillRecord): string | undefined => {
    if (skill.kind !== 'mcp') return undefined
    if (skill.availability?.available === false) return skill.availability.detail
    if (harness === 'pi' && !piMcpAdapterInstalled) return t('plugins.adapterRequiredDetail')
    return undefined
  }
  const capabilityControl = (skill: SkillRecord) => {
    if (skill.kind === 'mcp' && skill.availability?.available === false) {
      const external = skill.availability.detail.includes('managed outside Ptx')
      const label = external ? t('plugins.externallyManagedNamed', { name: skill.name }) : harness === 'pi' ? t('plugins.adapterRequiredNamed', { name: skill.name }) : t('plugins.unavailableNamed', { name: skill.name })
      return <span className="plugin-toggle" role="img" aria-label={label} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    if (harness === 'pi' && skill.kind === 'mcp' && !piMcpAdapterInstalled) {
      return <span className="plugin-toggle" role="img" aria-label={t('plugins.adapterRequiredNamed', { name: skill.name })} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    const isBrowser = skill.id === 'omp-work-browser'
    const actionable = skill.id === 'ptx-ask-user' || isBrowser || skill.id === 'ptx-computer-use' || skill.id === 'ptx-pi-mcp' || skill.kind === 'mcp' || skill.kind === 'package'
    if (!actionable) return <span className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={t(skill.enabled ? 'plugins.enabledNamed' : 'plugins.unavailableNamed', { name: skill.name })}>{skill.enabled ? <Check size={14}/> : <Plus size={14}/>}</span>
    const updating = skill.id === 'ptx-ask-user' ? askUserUpdating
      : isBrowser ? browserUpdating
        : skill.id === 'ptx-computer-use' ? computerUseUpdating
          : skill.id === 'ptx-pi-mcp' ? mcpSupportUpdating
            : capabilityUpdating === skill.id
    const enable = () => {
      if (skill.id === 'ptx-ask-user') return setAskUser(true)
      if (isBrowser) return setBrowser(true)
      if (skill.id === 'ptx-computer-use') return setComputerUse(skill, true)
      if (skill.id === 'ptx-pi-mcp') return setMcpSupport(skill, true)
      if (skill.kind === 'package') return mutate(skill, 'enable')
      return setMcp(skill, true)
    }
    return <button type="button" className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={t(skill.enabled ? 'plugins.disableNamed' : 'plugins.enableNamed', { name: skill.name })} aria-pressed={skill.enabled} disabled={updating} title={skill.availability?.detail} onClick={() => { if (skill.enabled) setConfirmDisable(skill); else void enable() }}>{updating ? <RefreshCw className="spin" size={14}/> : skill.enabled ? <><Check className="plugin-toggle__check" size={14}/><X className="plugin-toggle__disable" size={14}/></> : <Plus className="plugin-toggle__plus" size={14}/>}</button>
  }

  return (
    <div className="page plugin-page page--fixed-header">
        <header className="plugin-header page-fixed-header">
          <div><h1>{t('plugins.title', { harness: HARNESS_SHORT_NAMES[harness] })}</h1><p>{t('plugins.subtitle')}</p></div>
          <div>
            <button type="button" className="button" onClick={() => void onRefresh()}><RefreshCw className={loading ? 'spin' : ''} size={13}/> {t('plugins.refresh')}</button>
            {showHeaderAction ? <button type="button" className="button button--primary" onClick={openAdd}><Plus size={14}/> {t('plugins.add')}</button> : null}
          </div>
        </header>
      <div className="page-body-scroll scroll-area"><div className="page-container plugin-container">
        <div className="directory-tabs">
          <button type="button" className={tab === 'plugins' ? 'is-active' : ''} onClick={() => setTab('plugins')}>{t('plugins.tab.capabilities')}</button>
          <button type="button" className={tab === 'skills' ? 'is-active' : ''} onClick={() => setTab('skills')}>{t('plugins.tab.skills')}</button>
        </div>
        <div className="directory-tools">
          <label className="page-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(tab === 'plugins' ? 'plugins.search.capabilities' : 'plugins.search.skills')}/></label>
          <SelectMenu label={t('plugins.directoryFilter')} value={filter} onChange={setFilter} options={[
            { value: 'all', label: t('plugins.filter.all') },
            { value: 'installed', label: t('plugins.filter.installed') },
            { value: 'bundled', label: t('plugins.filter.bundled') },
            { value: 'user', label: t('plugins.filter.personal') },
            { value: 'project', label: t('plugins.filter.project') },
            { value: 'system', label: t('plugins.filter.system') },
          ]} />
        </div>
        {warnings.map((warning) => (
          <p key={`${warning.scope}:${warning.path}`} className="page-inline-error" role="alert">
            <AlertTriangle size={13} /> {warning.scope === 'project' ? t('plugins.warning.project', { message: warning.message, path: warning.path }) : t('plugins.warning.personal', { message: warning.message, path: warning.path })}
          </p>
        ))}
        {capabilityAlert ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {capabilityAlert}</p> : null}
        {computerUseAlert ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {computerUseAlert}</p> : null}
        {harness === 'pi' && mcpSupportAlert ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {mcpSupportAlert}</p> : null}
        {harness === 'pi' && mcpSupportNotice ? <p className="connection-warning" role="status">{mcpSupportUpdating ? <RefreshCw className="spin" size={13}/> : <ShieldCheck size={13}/>} {mcpSupportNotice}</p> : null}
        {harness === 'pi' && !piMcpAdapterInstalled ? <p className="connection-warning"><ShieldCheck size={13}/> {t('plugins.piMcpWarning')}</p> : null}
        <p className="connection-warning"><ShieldCheck size={13}/> {NETWORK_MCP_UNAVAILABLE_DETAIL}</p>
        <div className="directory-heading"><h2>{filter === 'installed' ? t('plugins.filter.installed') : tab === 'plugins' ? t('plugins.tab.capabilities') : t('plugins.tab.skills')}</h2><span>{t('plugins.shown', { count: visible.length })}</span></div>
        {visible.length ? (
          <div className="directory-list">{visible.map((skill) => {
            const statusDetail = mcpStatusDetail(skill)
            return <article key={skill.id}>
              <span className={`directory-icon directory-icon--${skill.kind}`}><SkillIcon skill={skill}/></span>
              <div><div><h3>{skill.name}</h3><span>{skill.location}</span></div><p id={statusDetail ? capabilityDetailId(skill) : undefined}>{skill.description}{statusDetail ? ` ${statusDetail}` : ''}</p></div>
              <div className="capability-actions">
                {skill.kind === 'package' || skill.kind === 'mcp' && skill.location !== 'bundled' && skill.location !== 'system' && skill.definitionRemovalAvailable !== false ? <button type="button" className="plugin-remove" aria-label={t('plugins.removeNamed', { name: skill.name })} disabled={capabilityUpdating === skill.id} onClick={() => setConfirmRemove(skill)}><Trash2 size={13}/></button> : null}
                {capabilityControl(skill)}
              </div>
            </article>
          })}</div>
        ) : <EmptyState icon={<Sparkles size={23}/>} title={t('plugins.emptyTitle')}>{t('plugins.emptyHint', { harness: HARNESS_SHORT_NAMES[harness] })}</EmptyState>}

        {confirmDisable ? <Modal title={t('plugins.disableConfirmTitle', { name: confirmDisable.name })} onClose={() => setConfirmDisable(null)} footer={<><button type="button" className="button" onClick={() => setConfirmDisable(null)}>{t('plugins.cancel')}</button><button type="button" className="button button--danger" onClick={() => void disableCapability(confirmDisable)}>{t('plugins.disableConfirm')}</button></>}><p className="modal-intro">{t('plugins.disableConfirmBody')}</p></Modal> : null}
        {confirmRemove ? <Modal title={t('plugins.removeConfirmTitle', { name: confirmRemove.name })} onClose={() => setConfirmRemove(null)} footer={<><button type="button" className="button" onClick={() => setConfirmRemove(null)}>{t('plugins.cancel')}</button><button type="button" className="button button--danger" onClick={() => void removeCapability(confirmRemove)}>{t('plugins.removeConfirm')}</button></>}><p className="modal-intro">{t('plugins.removeConfirmBody', { what: confirmRemove.kind === 'mcp' ? t('plugins.removeScope.mcp') : t('plugins.removeScope.package') })}</p></Modal> : null}

        {addOpen ? (
          <Modal
            title={addKind ? (addKind === 'mcp' ? t('plugins.addTitle.mcp') : addKind === 'extension' ? t('plugins.addTitle.extension') : t(`plugins.addTitle.package.${harness}`)) : t('plugins.addCapabilityTitle', { harness: HARNESS_SHORT_NAMES[harness] })}
            onClose={() => setAddOpen(false)}
            footer={addKind
              ? <><button type="button" className="button" onClick={() => selectAddKind(null)}><ArrowLeft size={13}/> {t('plugins.back')}</button><button type="button" className="button button--primary" disabled={!canAdd || adding} onClick={() => void add()}>{adding ? (addKind === 'mcp' ? t('plugins.saving') : t('plugins.installing')) : (addKind === 'mcp' ? t('plugins.saveLocalServer') : addKind === 'extension' ? t('plugins.installExtension') : t(`plugins.install.${harness === 'omp' ? 'plugin' : 'package'}`))}</button></>
              : <button type="button" className="button" onClick={() => setAddOpen(false)}>{t('plugins.cancel')}</button>}
          >
            {addKind === null ? (
              <div className="capability-choice-list">
                <button type="button" disabled={harness === 'pi' && !piMcpAdapterInstalled} onClick={() => selectAddKind('mcp')}>
                  <span><Globe2 size={17}/></span><span><strong>{t('plugins.addMcp')}</strong><small>{harness === 'pi' && !piMcpAdapterInstalled ? t('plugins.addMcp.enableAdapterFirst') : t('plugins.addMcp.localStdio')}</small></span><ChevronRight size={15}/>
                </button>
                <button type="button" onClick={() => selectAddKind('bundle')}>
                  <span><Package size={17}/></span><span><strong>{t(harness === 'omp' ? 'plugins.add.plugin' : 'plugins.add.package')}</strong><small>{t(PACKAGE_HELP[harness])}</small></span><ChevronRight size={15}/>
                </button>
                <button type="button" onClick={() => selectAddKind('extension')}>
                  <span><FileCode2 size={17}/></span><span><strong>{t('plugins.addExtension')}</strong><small>{t('plugins.addExtensionHint', { harness: HARNESS_SHORT_NAMES[harness] })}</small></span><ChevronRight size={15}/>
                </button>
                  <p className="capability-compatibility-note"><AlertTriangle size={13}/><span>{t('plugins.compatNote')}<button type="button" onClick={() => onOpenExternal(GITHUB_ISSUES_URL)}>{t('plugins.compatIssueLink')}</button>.</span></p>
              </div>
            ) : addKind === 'bundle' ? (
              <div className="add-tool-form">
                <p className="modal-intro">{t(PACKAGE_HELP[harness])} {t('plugins.bundleInstallNote')}</p>
                <label className="field"><span>{t('plugins.sourceLabel', { label: t(PACKAGE_LABELS[harness]) })}</span><input autoFocus value={source} onChange={(event) => setSource(event.target.value)} placeholder={harness === 'omp' ? 'plugin-name@marketplace' : 'npm:@scope/package'}/></label>
                <small className="field-help">{harness === 'omp' ? <>{t('plugins.examples.omp.pre')}<code>name@marketplace</code>{t('plugins.examples.omp.post')}</> : <>{t('plugins.examples.pi.pre')}<code>npm:@scope/package</code>{t('plugins.examples.pi.post')}</>}</small>
              </div>
            ) : addKind === 'extension' ? (
              <div className="add-tool-form">
                <p className="modal-intro">{harness === 'omp'
                  ? t('plugins.extensionIntro.omp')
                  : t('plugins.extensionIntro.generic', { harness: HARNESS_SHORT_NAMES[harness] })}</p>
                <label className="field"><span>{t('plugins.extensionFile')}</span><input autoFocus value={source} onChange={(event) => setSource(event.target.value)} placeholder="/absolute/path/to/my-extension.ts"/></label>
                <small className="field-help">{t('plugins.extHelp.pre')}<code>.ts</code>{t('plugins.extHelp.sep')}<code>.js</code>{t('plugins.extHelp.sep')}<code>.mjs</code>{t('plugins.extHelp.or')}<code>.cjs</code>{t('plugins.extHelp.post')}</small>
                <label className="field"><span>{t('plugins.availableIn')}</span><SelectMenu label={t('plugins.availableIn')} value={mcpScope} onChange={(next) => setMcpScope(next as McpScope)} options={[{ value: 'user', label: t('plugins.scopeAll') }, { value: 'project', label: t('plugins.scopeCurrent'), disabled: !activeProjectPath }]} /></label>
                <p className="connection-warning"><ShieldCheck size={13}/> {t('plugins.extensionWarning')}</p>
              </div>
            ) : (
              <div className="add-tool-form">
                <p className="modal-intro">{harness === 'omp'
                  ? t('plugins.mcpIntro.omp')
                  : t('plugins.mcpIntro.pi')}</p>
                <label className="field"><span>{t('plugins.serverName')}</span><input autoFocus value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="my-local-tools"/></label>
                <p className="field-help">{t(MCP_STDIO_HELP[harness])}</p>
                <label className="field"><span>{t('plugins.executable')}</span><input value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} placeholder="npx"/></label>
                <label className="field"><span>{t('plugins.arguments')} <small>{t('plugins.argumentsHint')}</small></span><textarea value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'}/></label>
                <label className="field"><span>{t('plugins.availableIn')}</span><SelectMenu label={t('plugins.availableIn')} value={mcpScope} onChange={(next) => setMcpScope(next as McpScope)} options={[{ value: 'user', label: t('plugins.scopeAll') }, { value: 'project', label: t('plugins.scopeCurrent'), disabled: !activeProjectPath }]} /></label>
                <p className="connection-warning"><ShieldCheck size={13}/> {t('plugins.mcpTrustWarning')}</p>
              </div>
            )}
            {result ? <pre className="install-output" role="status">{result}</pre> : null}
          </Modal>
        ) : null}
      </div>
      </div>
    </div>
  )
}
