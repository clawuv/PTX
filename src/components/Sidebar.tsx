import {
  Archive,
  ArrowLeft,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  Folder,
  LoaderCircle,
  MessageCircleQuestion,
  MoreHorizontal,
  NotebookPen,
  PackageOpen,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { AppMeta, AppUpdateState, HarnessId, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES, HARNESS_SELECTOR_ORDER, HARNESS_SHORT_NAMES } from '@/lib/harness'
import { useI18n, type MessageKey, type MessageValues } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { sessionAttentionSignature, signatureCleared } from '@/app/session-attention'
import type { SettingsSection } from '@/pages/settings/contracts'
import { SETTINGS_SECTIONS } from '@/pages/settings/sections'
import { IconButton, Modal, OmpMark, PiMark, PrimeMark } from './ui'

export interface SidebarProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  harnesses?: AppMeta['harnesses'] | null
  clearedAttention?: Record<string, string>
  updateState?: AppUpdateState
  onUpdateAction?(): void | Promise<void>
  onSelectHarness?(harness: HarnessId): void
  onSelectProject(project: ProjectRecord): void
  onSelectSession(session: SessionRecord): void
  onNavigate(view: WorkspaceView): void
  onNewSession(project?: ProjectRecord): void
  onAddProject(): void
  onRemoveProject(project: ProjectRecord): void
  onOpenDocs?(): void
  onOpenPalette(): void
  onRenameSession(session: SessionRecord, title: string): Promise<void>
  onArchiveSession(session: SessionRecord): Promise<void>
  /** Settings mode: the sidebar body is replaced by the settings section menu. */
  settingsMode?: boolean
  activeSettingsSection?: SettingsSection
  onSelectSettingsSection?(section: SettingsSection): void
  platform?: NodeJS.Platform
  /** Scheduled tasks needing attention (blocked, failed, or interrupted). */
  schedulesAttention?: number
}

type Translate = (key: MessageKey, values?: MessageValues) => string

const statusLabel: Record<SessionRecord['status'], MessageKey> = {
  idle: 'sidebar.status.idle', running: 'sidebar.status.running', waiting: 'sidebar.status.waiting', complete: 'sidebar.status.complete', failed: 'sidebar.status.failed', unknown: 'sidebar.status.unknown',
}

export const SIDEBAR_SESSION_LIMIT = 7

export interface SidebarIndexStats {
  projectPaths: number
  sessionScans: number
}

export function indexSidebarSessions(
  projects: ProjectRecord[],
  sessions: SessionRecord[],
  stats?: SidebarIndexStats,
): { activeSessions: SessionRecord[]; unassignedSessions: SessionRecord[]; sessionsByProject: Map<string, SessionRecord[]> } {
  const activeSessions: SessionRecord[] = []
  const unassignedSessions: SessionRecord[] = []
  const owners = new Map<string, string[]>()
  const sessionsByProject = new Map(projects.map((project) => [project.id, [] as SessionRecord[]]))
  for (const project of projects) for (const path of new Set([project.path, ...project.folders])) {
    if (stats) stats.projectPaths += 1
    const entries = owners.get(path) ?? []
    entries.push(project.id)
    owners.set(path, entries)
  }
  for (const session of sessions) {
    if (stats) stats.sessionScans += 1
    if (session.archived) continue
    activeSessions.push(session)
    const projectIds = owners.get(session.projectPath)
    if (projectIds?.length) for (const projectId of projectIds) sessionsByProject.get(projectId)?.push(session)
    else unassignedSessions.push(session)
  }
  const compareByLastUserMessage = (left: SessionRecord, right: SessionRecord) => {
    const difference = Date.parse(right.lastUserMessageAt ?? right.createdAt) - Date.parse(left.lastUserMessageAt ?? left.createdAt)
    return difference || right.createdAt.localeCompare(left.createdAt) || left.filePath.localeCompare(right.filePath)
  }
  activeSessions.sort(compareByLastUserMessage)
  unassignedSessions.sort(compareByLastUserMessage)
  for (const projectSessions of sessionsByProject.values()) projectSessions.sort(compareByLastUserMessage)
  return { activeSessions, unassignedSessions, sessionsByProject }
}

export function boundedSidebarSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, SIDEBAR_SESSION_LIMIT)
}


function SessionStatusMark({ status, attention }: { status: SessionRecord['status']; attention: boolean }) {
  const { t } = useI18n()
  const title = status === 'failed' && !attention ? t('sidebar.failedCleared') : t(statusLabel[status])
  if (status === 'running') return <span className="session-status-mark session-status-mark--running" title={t(statusLabel[status])}><LoaderCircle className="spin" size={13} /></span>
  if (status === 'waiting') return <span className="session-status-mark session-status-mark--waiting" title={t(statusLabel[status])}><MessageCircleQuestion size={12} /></span>
  if (status === 'complete') return <span className="session-status-mark session-status-mark--complete" title={t(statusLabel[status])}><CheckCircle2 size={12} /></span>
  return <span className={`session-status-mark session-status-mark--${status}`} title={title}><span /></span>
}

const HARNESS_MARKS: Record<HarnessId, (props: { size?: number }) => ReactElement> = { omp: OmpMark, prime: PrimeMark, pi: PiMark }

function HarnessMark({ harness, size }: { harness: HarnessId; size: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
}

function updateControlCopy(state: AppUpdateState, t: Translate): { label: string; title: string } {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'checking': return { label: t('sidebar.update.checking'), title: t('sidebar.update.checkingTitle') }
    case 'available': return { label: t('sidebar.update.download', { version }), title: t('sidebar.update.downloadTitle', { version }) }
    case 'downloading': return {
      label: state.percent === undefined ? t('sidebar.update.downloading', { version }) : t('sidebar.update.downloadingPercent', { version, percent: state.percent }),
      title: t('sidebar.update.downloadingTitle', { version }),
    }
    case 'downloaded': return { label: t('sidebar.update.restartFor', { version }), title: t('sidebar.update.restartTitle', { version }) }
    case 'not-available': return { label: t('sidebar.update.upToDate'), title: t('sidebar.update.checkAgain') }
    case 'error': return { label: t('sidebar.update.retry', { version }), title: state.message ?? t('sidebar.update.errorTitle') }
    case 'unsupported': return { label: t('sidebar.update.automatic'), title: state.message ?? t('sidebar.update.unsupportedTitle') }
    default: return { label: t('sidebar.update.releaseUpdates'), title: t('sidebar.update.releaseTitle') }
  }
}

/** Announced without the percentage so progress ticks do not spam assistive tech. */
function updateAnnouncement(state: AppUpdateState, t: Translate): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'available': return t('sidebar.update.availableAnnouncement', { version })
    case 'downloading': return t('sidebar.update.downloadingAnnouncement', { version })
    case 'downloaded': return t('sidebar.update.readyAnnouncement', { version })
    case 'error': return t('sidebar.update.failedAnnouncement', { message: state.message ?? t('sidebar.update.tryAgain') })
    default: return ''
  }
}

function updateConfirmCopy(state: AppUpdateState, t: Translate): { title: string; body: string } {
  if (state.phase === 'downloaded') return {
    title: t('sidebar.update.confirmRestartTitle'),
    body: t('sidebar.update.confirmRestartBody'),
  }
  return {
    title: t('sidebar.update.confirmDownloadTitle'),
    body: t('sidebar.update.confirmDownloadBody'),
  }
}

async function copySessionUuid(id: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(id)
      return
    } catch {
      // Fall back to the document copy command when clipboard permission is unavailable.
    }
  }
  const input = document.createElement('textarea')
  input.value = id
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Copy is unavailable')
}

function SidebarView({ projects, sessions, activeProjectId, activeSessionId, activeView, activeHarness = 'omp', harnesses, clearedAttention = {}, updateState = { phase: 'unsupported' }, onUpdateAction, onSelectHarness, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, onOpenDocs, onOpenPalette, onRenameSession, onArchiveSession, settingsMode = false, activeSettingsSection = 'general', onSelectSettingsSection, platform = 'darwin', schedulesAttention = 0 }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [sessionMenuAt, setSessionMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const { unassignedSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [projectsSectionCollapsed, setProjectsSectionCollapsed] = useState(false)
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
  }
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  const updateCopy = updateControlCopy(updateState, t)
  const updateConfirm = updateConfirmCopy(updateState, t)
  const updateBusy = updateState.phase === 'checking' || updateState.phase === 'downloading'
  const updateIndeterminate = updateState.phase === 'downloading' && updateState.percent === undefined
  const updateVisible = updateState.phase === 'available' || updateState.phase === 'downloading' || updateState.phase === 'downloaded' || updateState.phase === 'error'
  useEffect(() => {
    if (!harnessMenuOpen) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.brand-switcher')) setHarnessMenuOpen(false) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setHarnessMenuOpen(false) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [harnessMenuOpen])
  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.project-group')) setProjectMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setProjectMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [projectMenu])
  useEffect(() => {
    if (!sessionMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.session-row-wrap, .session-row__menu')) setSessionMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setSessionMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [sessionMenu])
  // The menu portals to <body> so the sidebar's scroll container cannot clip it; it anchors to the row's right edge.
  const openSessionMenu = (id: string, rect: DOMRect) => {
    setSessionMenu(id)
    setSessionMenuAt({ x: rect.right + 4, y: Math.min(rect.top, Math.max(0, window.innerHeight - 105)) })
  }
  const normalized = query.trim().toLowerCase()
  const activeProjectName = projects.find((project) => project.id === activeProjectId)?.name ?? 'PiStudio'
  const visibleProjects = useMemo(() => projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || (sessionsByProject.get(project.id) ?? []).some((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))), [projects, sessionsByProject, normalized])
  const renderSessionRow = (session: SessionRecord, selected: boolean) => (
    <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${needsAttention(session) ? 'has-attention' : ''} ${selected && activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''}`}>
      <button type="button" title={session.title} className="session-row" onClick={() => { setSessionMenu(null); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); openSessionMenu(session.id, event.currentTarget.getBoundingClientRect()) }}>
        {session.status === 'running' || session.status === 'waiting' || session.status === 'failed' ? <SessionStatusMark status={session.status} attention={needsAttention(session)} /> : null}
        <span className="session-row__text"><span className="session-row__title">{session.title}</span><span className="session-row__meta">{session.status === 'running' ? t('sidebar.working') : session.status === 'waiting' ? t('sidebar.needsAttention') : session.status === 'complete' ? t('sidebar.status.complete') : formatRelative(session.updatedAt)}</span></span>
        <span className="session-row__time">{formatRelative(session.updatedAt)}</span>
      </button>
      <IconButton size="small" className="session-row__more" label={t('sidebar.sessionOptionsFor', { title: session.title })} onClick={(event) => { if (sessionMenu === session.id) setSessionMenu(null); else openSessionMenu(session.id, event.currentTarget.getBoundingClientRect()) }}><MoreHorizontal size={13}/></IconButton>
      {sessionMenu === session.id && sessionMenuAt ? createPortal(<div className="session-row__menu" aria-label={t('sidebar.sessionOptions')} style={{ left: sessionMenuAt.x, top: sessionMenuAt.y }}><button type="button" onClick={() => { void copySessionUuid(session.id); setSessionMenu(null) }}><Copy size={12}/> {t('sidebar.copyUuid')}</button><button type="button" onClick={() => { setRenameTarget(session); setRenameValue(session.title); setSessionMenu(null) }}><SquarePen size={12}/> {t('sidebar.rename')}</button><button type="button" onClick={() => { setSessionMenu(null); void onArchiveSession(session) }}><Archive size={12}/> {t('sidebar.archive')}</button></div>, document.body) : null}
    </div>
  )

  return (
    <aside className="sidebar" aria-label={t('sidebar.nav')}>
      {settingsMode ? null : (
        <div className="sidebar__titlebar drag-region">
          <div className="sidebar__brand brand-switcher no-drag">
          <button
            type="button"
            className="brand-switcher__trigger"
            aria-haspopup="menu"
            aria-expanded={harnessMenuOpen}
            aria-label={t('sidebar.switchHarness', { name: HARNESS_PRODUCT_NAMES[activeHarness] })}
            title={t('sidebar.switchHarness', { name: HARNESS_PRODUCT_NAMES[activeHarness] })}
            onClick={() => setHarnessMenuOpen((open) => !open)}
          >
            <span className="brand-switcher__name"><strong>{HARNESS_SHORT_NAMES[activeHarness]}</strong></span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {harnessMenuOpen ? (
            <div className="brand-switcher__menu" role="menu" aria-label={t('sidebar.harnessMenu')}>
              {HARNESS_SELECTOR_ORDER.filter((harness) => Boolean(harnesses?.[harness]?.path)).map((harness) => (
                  <button
                    type="button"
                    key={harness}
                    role="menuitemradio"
                    aria-checked={harness === activeHarness}
                    className={harness === activeHarness ? 'is-active' : ''}
                    onClick={() => { setHarnessMenuOpen(false); if (harness !== activeHarness) onSelectHarness?.(harness) }}
                  >
                    <HarnessMark harness={harness} size={20} />
                    <span className="brand-switcher__option"><strong>{HARNESS_PRODUCT_NAMES[harness]}</strong></span>
                    {harness === activeHarness ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton label={t('sidebar.search')} onClick={() => { setSearchOpen((open) => !open); window.setTimeout(() => document.getElementById('session-search')?.focus(), 0) }} className={searchOpen ? 'is-active' : ''}><Search size={16} /></IconButton>
          <IconButton label={t('nav.activity')} className={activeView === 'activity' ? 'is-active' : ''} onClick={() => onNavigate('activity')}><Bell size={16} /></IconButton>
        </div>
        </div>
      )}
      {settingsMode ? (
        <nav className="sidebar__settings-nav scroll-area" aria-label={t('settings.sections')}>
          <button type="button" className="sidebar__settings-back" onClick={() => onNavigate('session')}>
            <ArrowLeft size={15} /><span>{t('settings.back')}</span>
          </button>
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={activeSettingsSection === id ? 'is-active' : ''} onClick={() => onSelectSettingsSection?.(id)}>
              <Icon size={15} /><span>{t(label)}</span>
            </button>
          ))}
        </nav>
      ) : (
        <>
          {searchOpen ? (
            <div className="sidebar-search-wrap">
              <div className="sidebar-search">
                <Search size={13} />
                <input id="session-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('sidebar.searchPlaceholder')} aria-label={t('sidebar.searchLabel')} />
                {query ? <button type="button" title={t('sidebar.clearSearch')} aria-label={t('sidebar.clearSearch')} onClick={() => setQuery('')}>×</button> : null}
              </div>
            </div>
          ) : null}

          <nav className="sidebar__primary" aria-label={t('sidebar.primaryNav')}>
            <button type="button" title={t('sidebar.newSessionTitle', { shortcut: newSessionShortcut })} onClick={() => onNewSession()}><NotebookPen size={15} /><span>{t('sidebar.newSession')}</span><kbd>{newSessionShortcut}</kbd></button>
            <button type="button" title={t('nav.projects')} className={activeView === 'projects' ? 'is-active' : ''} onClick={() => onNavigate('projects')}><Folder size={15} /><span>{t('nav.projects')}</span></button>
            <button type="button" title={t('nav.scheduled')} className={activeView === 'scheduled' ? 'is-active' : ''} onClick={() => onNavigate('scheduled')}><CalendarClock size={15} /><span>{t('nav.scheduled')}</span>{schedulesAttention > 0 ? <i className="nav-attention-badge" aria-label={t('scheduled.attentionBadge', { count: schedulesAttention })}>{schedulesAttention > 9 ? '9+' : schedulesAttention}</i> : null}</button>
            <button type="button" title={t('nav.capabilities')} className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><PackageOpen size={15} /><span>{t('nav.capabilities')}</span></button>
          </nav>

          <div className="sidebar__scroll scroll-area">
            <div className="sidebar__section-heading">
              <button type="button" className="section-heading__label" aria-expanded={!projectsSectionCollapsed} onClick={() => setProjectsSectionCollapsed((value) => !value)}>
                <span>{t('nav.projects')}</span>
                <ChevronDown className={`section-heading__chevron ${projectsSectionCollapsed ? 'is-collapsed' : ''}`} aria-hidden="true" />
              </button>
              <span className="section-heading__actions">
                <IconButton size="small" label={t('sidebar.moreActions')} onClick={onOpenPalette}><MoreHorizontal size={13} /></IconButton>
                <IconButton size="small" label={t('sidebar.addProject')} onClick={onAddProject}><Plus size={13} /></IconButton>
              </span>
            </div>
            {projectsSectionCollapsed && !normalized ? null : (
            <>
            {visibleProjects.map((project) => {
              const projectSessions = (sessionsByProject.get(project.id) ?? []).filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))
              const collapsed = collapsedProjects.has(project.id)
              return (
                <div className="project-group" key={project.id}>
                  <div
                    className="project-row"
                    onContextMenu={(event) => { event.preventDefault(); setProjectMenu(project.id) }}
                  >
                    <button className="project-row__main" type="button" title={project.name} onClick={() => setCollapsedProjects((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next })}>
                      <Folder size={15} />
                      <span>{project.name}</span>
                    </button>
                    <IconButton size="small" className="project-row__new-session row-action" label={t('sidebar.newSessionIn', { project: project.name })} onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotebookPen size={13} /></IconButton>
                    {projectMenu === project.id ? <div className="project-row__menu" role="menu" aria-label={t('sidebar.projectOptions', { name: project.name })}><button type="button" role="menuitem" onClick={() => { setProjectMenu(null); setRemoveTarget(project) }}><Trash2 size={12} /> {t('sidebar.removeProject')}</button></div> : null}
                  </div>
                  {collapsed ? null : (
                    <div className="project-sessions">
                      {projectSessions.map((session) => renderSessionRow(session, activeSessionId === session.id && activeView === 'session'))}
                    </div>
                  )}
                </div>
              )
            })}

            </>
            )}

            {unassignedSessions.length ? (
            <div className="sidebar__section-heading sidebar__section-heading--recent">
              <button type="button" className="section-heading__label" aria-expanded={!recentCollapsed} onClick={() => setRecentCollapsed((value) => !value)}>
                <span>{t('sidebar.recent')}</span>
                <ChevronDown className={`section-heading__chevron ${recentCollapsed ? 'is-collapsed' : ''}`} aria-hidden="true" />
              </button>
            </div>
            ) : null}
            {recentCollapsed ? null : boundedSidebarSessions(unassignedSessions.filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))).map((session) => renderSessionRow(session, activeSessionId === session.id && activeView === 'session'))}
          </div>
        </>
      )}

      {settingsMode ? null : (
        <div className="sidebar__footer">
        {updateVisible ? (
          <>
            <span className="sr-only" role="status" aria-live="polite">{updateAnnouncement(updateState, t)}</span>
            <button
              type="button"
              className={`sidebar-update sidebar-update--${updateState.phase} ${updateIndeterminate ? 'sidebar-update--indeterminate' : ''}`}
              title={updateCopy.title}
              aria-label={updateCopy.title}
              disabled={updateBusy}
              onClick={() => { if (updateState.phase === 'error') void onUpdateAction?.(); else setConfirmUpdate(true) }}
            >
              <span className="sidebar-update__icon" style={{ '--update-progress': `${updateState.percent ?? 0}%` } as CSSProperties}><Download size={12} /></span>
              <span className="sr-only">{updateCopy.label}</span>
            </button>
          </>
        ) : null}
        <button type="button" title={t('nav.settings')} className={`sidebar__settings-entry${settingsMode ? ' is-active' : ''}`} onClick={() => onNavigate(settingsMode ? 'session' : 'settings')}><Settings size={15} /><span>{activeProjectName}</span><kbd>{settingsShortcut}</kbd></button>
        {onOpenDocs ? <IconButton className="sidebar__help" size="small" label={t('menu.help')} onClick={() => onOpenDocs()}><CircleHelp size={15} /></IconButton> : null}
        </div>
      )}
      {renameTarget ? <Modal title={t('sidebar.renameTitle')} onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>{t('sidebar.cancel')}</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>{t('sidebar.rename')}</button></>}><label className="field"><span>{t('sidebar.sessionName')}</span><input autoFocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {removeTarget ? <Modal title={t('sidebar.removeProject')} onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>{t('sidebar.cancel')}</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>{t('sidebar.remove')}</button></>}><p>{t('sidebar.removeConfirm', { name: removeTarget.name, harness: HARNESS_PRODUCT_NAMES[activeHarness] })}</p></Modal> : null}
      {confirmUpdate ? <Modal title={updateConfirm.title} onClose={() => setConfirmUpdate(false)} footer={<><button type="button" className="button" onClick={() => setConfirmUpdate(false)}>{t('sidebar.update.confirmNo')}</button><button type="button" className="button button--primary" onClick={() => { setConfirmUpdate(false); void onUpdateAction?.() }}>{t('sidebar.update.confirmYes')}</button></>}><p>{updateConfirm.body}</p></Modal> : null}
    </aside>
  )
}

export function areSidebarPropsEqual(previous: SidebarProps, next: SidebarProps): boolean {
  return previous.projects === next.projects
    && previous.sessions === next.sessions
    && previous.activeProjectId === next.activeProjectId
    && previous.activeSessionId === next.activeSessionId
    && previous.activeView === next.activeView
    && previous.activeHarness === next.activeHarness
    && previous.harnesses === next.harnesses
    && previous.clearedAttention === next.clearedAttention
    && previous.updateState === next.updateState
    && previous.onUpdateAction === next.onUpdateAction
    && previous.onSelectHarness === next.onSelectHarness
    && previous.onSelectProject === next.onSelectProject
    && previous.onSelectSession === next.onSelectSession
    && previous.onNavigate === next.onNavigate
    && previous.onNewSession === next.onNewSession
    && previous.onAddProject === next.onAddProject
    && previous.onRemoveProject === next.onRemoveProject
    && previous.onOpenDocs === next.onOpenDocs
    && previous.onOpenPalette === next.onOpenPalette
  && previous.onRenameSession === next.onRenameSession
  && previous.onArchiveSession === next.onArchiveSession
  && previous.settingsMode === next.settingsMode
  && previous.activeSettingsSection === next.activeSettingsSection
  && previous.onSelectSettingsSection === next.onSelectSettingsSection
    && previous.platform === next.platform
  && previous.schedulesAttention === next.schedulesAttention
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
