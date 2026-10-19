import { MobileConnectionButton } from './MobileConnectionButton'
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Copy,
  Folder,
  LoaderCircle,
  MessageCircleQuestion,
  MessageSquarePlus,
  MoreHorizontal,
  PackageOpen,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { AppMeta, HarnessId, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES, HARNESS_SELECTOR_ORDER, HARNESS_SHORT_NAMES } from '@/lib/harness'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { sessionAttentionSignature, signatureCleared } from '@/app/session-attention'
import type { SettingsSection } from '@/pages/settings/contracts'
import { SETTINGS_SECTION_GROUPS } from '@/pages/settings/sections'
import { IconButton, Modal, OmpMark, PiMark } from './ui'

export interface SidebarProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  harnesses?: AppMeta['harnesses'] | null
  clearedAttention?: Record<string, string>
  onSelectHarness?(harness: HarnessId): void
  onSelectProject(project: ProjectRecord): void
  onSelectSession(session: SessionRecord): void
  onNavigate(view: WorkspaceView): void
  onNewSession(project?: ProjectRecord): void
  onAddProject(): void
  onRemoveProject(project: ProjectRecord): void
  onOpenPalette(): void
  onRenameSession(session: SessionRecord, title: string): Promise<void>
  onArchiveSession(session: SessionRecord): Promise<void>
  /** Settings mode: the sidebar body is replaced by the settings section menu. */
  settingsMode?: boolean
  searchOpen?: boolean
  activeSettingsSection?: SettingsSection
  onSelectSettingsSection?(section: SettingsSection): void
  platform?: NodeJS.Platform
  /** Scheduled tasks needing attention (blocked, failed, or interrupted). */
  schedulesAttention?: number
}


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


function isSameLocalDay(value: string): boolean {
  const time = new Date(value).getTime()
  return Number.isFinite(time) && new Date(time).toDateString() === new Date().toDateString()
}

function SessionStatusMark({ status, attention, today }: { status: SessionRecord['status']; attention: boolean; today: boolean }) {
  const { t } = useI18n()
  const title = status === 'failed' && !attention ? t('sidebar.failedCleared') : t(statusLabel[status])
  if (status === 'running') return <span className="session-status-mark session-status-mark--running" data-tooltip={t(statusLabel[status])}><LoaderCircle className="spin" size={13} /></span>
  if (status === 'waiting') return <span className="session-status-mark session-status-mark--waiting" data-tooltip={t(statusLabel[status])}><MessageCircleQuestion size={12} /></span>
  if (status === 'failed') return <span className="session-status-mark session-status-mark--failed" data-tooltip={title}><span /></span>
  return <span className={`session-status-mark session-status-mark--day${today ? ' is-today' : ''}`} data-tooltip={title}><span /></span>
}

const HARNESS_MARKS: Record<HarnessId, (props: { size?: number }) => ReactElement> = { omp: OmpMark, pi: PiMark }

function HarnessMark({ harness, size }: { harness: HarnessId; size: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
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

function SidebarView({ projects, sessions, activeProjectId, activeSessionId, activeView, activeHarness = 'omp', harnesses, clearedAttention = {}, onSelectHarness, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, onRenameSession, onArchiveSession, settingsMode = false, searchOpen = false, activeSettingsSection = 'general', onSelectSettingsSection, platform = 'darwin', schedulesAttention = 0 }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (searchOpen && !settingsMode) document.getElementById('session-search')?.focus()
  }, [searchOpen, settingsMode])
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [sessionMenuAt, setSessionMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const { sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [projectsSectionCollapsed, setProjectsSectionCollapsed] = useState(false)
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
  }
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
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
  const activeProjectName = projects.find((project) => project.id === activeProjectId)?.name ?? 'Ptx'
  const visibleProjects = useMemo(() => projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || (sessionsByProject.get(project.id) ?? []).some((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))), [projects, sessionsByProject, normalized])
  const renderSessionRow = (session: SessionRecord, selected: boolean) => (
    <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${needsAttention(session) ? 'has-attention' : ''} ${selected && activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''}`}>
      <button type="button" className="session-row" onClick={() => { setSessionMenu(null); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); openSessionMenu(session.id, event.currentTarget.getBoundingClientRect()) }}>
        <SessionStatusMark status={session.status} attention={needsAttention(session)} today={isSameLocalDay(session.lastUserMessageAt ?? session.updatedAt)} />
        <span className="session-row__text"><span className="session-row__title">{session.title}</span><span className="session-row__meta">{session.status === 'running' ? t('sidebar.working') : session.status === 'waiting' ? t('sidebar.needsAttention') : session.status === 'complete' ? t('sidebar.status.complete') : formatRelative(session.updatedAt)}</span></span>
        <span className="session-row__time">{formatRelative(session.updatedAt)}</span>
      </button>
      {/* Hover affordance kept, but no tooltip: the row title and menu items are self-explanatory. */}
      <IconButton size="small" className="session-row__more" label={t('sidebar.sessionOptionsFor', { title: session.title })} data-tooltip={undefined} onClick={(event) => { if (sessionMenu === session.id) setSessionMenu(null); else openSessionMenu(session.id, event.currentTarget.getBoundingClientRect()) }}><MoreHorizontal size={13}/></IconButton>
      {sessionMenu === session.id && sessionMenuAt ? createPortal(<div className="session-row__menu" aria-label={t('sidebar.sessionOptions')} style={{ left: sessionMenuAt.x, top: sessionMenuAt.y }}><button type="button" onClick={() => { void copySessionUuid(session.id); setSessionMenu(null) }}><Copy size={12}/> {t('sidebar.copyUuid')}</button><button type="button" onClick={() => { setRenameTarget(session); setRenameValue(session.title); setSessionMenu(null) }}><SquarePen size={12}/> {t('sidebar.rename')}</button><button type="button" onClick={() => { setSessionMenu(null); void onArchiveSession(session) }}><Archive size={12}/> {t('sidebar.archive')}</button></div>, document.body) : null}
    </div>
  )

  return (
    <aside className="sidebar" aria-label={t('sidebar.nav')}>
      {settingsMode ? null : (
        <div className="sidebar__titlebar">
          <div className="brand-switcher no-drag" role="group" aria-label={t('sidebar.harnessMenu')}>
            {HARNESS_SELECTOR_ORDER.map((harness) => (
              <button
                type="button"
                key={harness}
                className="brand-switcher__segment"
                aria-pressed={harness === activeHarness}
                aria-label={t('sidebar.switchHarness', { name: HARNESS_PRODUCT_NAMES[harness] })}
                onClick={() => {
                  if (harnesses && !harnesses[harness].path) {
                    onNavigate('settings')
                    onSelectSettingsSection?.('agent')
                  } else if (harness !== activeHarness) onSelectHarness?.(harness)
                }}
              >
                <HarnessMark harness={harness} size={15} />
                <span>{HARNESS_SHORT_NAMES[harness]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {settingsMode ? (
        <nav className="sidebar__settings-nav scroll-area" aria-label={t('settings.sections')}>
          <button type="button" className="sidebar__settings-back" onClick={() => onNavigate('session')}>
            <ArrowLeft size={15} /><span>{t('settings.back')}</span>
          </button>
          {SETTINGS_SECTION_GROUPS.map((group) => (
            <div key={String(group.label)} className="sidebar__settings-group" role="group" aria-label={t(group.label)}>
              <div className="sidebar__settings-group-label">{t(group.label)}</div>
              {group.sections.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={activeSettingsSection === id ? 'is-active' : ''} onClick={() => onSelectSettingsSection?.(id)}>
                  <Icon size={14} /><span>{t(label)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      ) : (
        <>
          {searchOpen ? (
            <div className="sidebar-search-wrap">
              <div className="sidebar-search">
                <Search size={13} />
                <input id="session-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('sidebar.searchPlaceholder')} aria-label={t('sidebar.searchLabel')} />
                {query ? <button type="button" data-tooltip={t('sidebar.clearSearch')} aria-label={t('sidebar.clearSearch')} onClick={() => setQuery('')}>×</button> : null}
              </div>
            </div>
          ) : null}

          <nav className="sidebar__primary" aria-label={t('sidebar.primaryNav')}>
            <button type="button" className={activeView === 'session' && activeSessionId === undefined ? 'is-active' : ''} onClick={() => onNewSession()}><MessageSquarePlus size={15} /><span>{t('sidebar.newSession')}</span><kbd>{newSessionShortcut}</kbd></button>
            <button type="button" className={activeView === 'tasks' ? 'is-active' : ''} onClick={() => onNavigate('tasks')}><CheckCircle2 size={15} /><span>{t('nav.tasks')}</span></button>
            <button type="button" className={activeView === 'scheduled' ? 'is-active' : ''} onClick={() => onNavigate('scheduled')}><CalendarClock size={15} /><span>{t('nav.scheduled')}</span>{schedulesAttention > 0 ? <i className="nav-attention-badge" aria-label={t('scheduled.attentionBadge', { count: schedulesAttention })}>{schedulesAttention > 9 ? '9+' : schedulesAttention}</i> : null}</button>
            <button type="button" className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><PackageOpen size={15} /><span>{t('nav.capabilities')}</span></button>
          </nav>

          <div className="sidebar__scroll scroll-area">
            <div className="sidebar__section-heading">
              <button type="button" className="section-heading__label" aria-expanded={!projectsSectionCollapsed} onClick={() => setProjectsSectionCollapsed((value) => !value)}>
                <span>{t('nav.projects')}</span>
                <ChevronDown className={`section-heading__chevron ${projectsSectionCollapsed ? 'is-collapsed' : ''}`} aria-hidden="true" />
              </button>
              <span className="section-heading__actions">
                <IconButton size="small" className="section-heading__more" label={t('sidebar.projectSettings')} onClick={() => { onNavigate('settings'); onSelectSettingsSection?.('projects') }}><MoreHorizontal size={13} /></IconButton>
                <IconButton size="small" label={t('sidebar.addProject')} onClick={onAddProject}><Plus size={13} /></IconButton>
              </span>
            </div>
            {projectsSectionCollapsed && !normalized ? null : (
            <>
            {visibleProjects.map((project) => {
              const projectSessions = (sessionsByProject.get(project.id) ?? []).filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))
              const collapsed = collapsedProjects.has(project.id)
              // Selecting a session highlights only that child row; the parent
              // project row keeps its own highlight solely when no session of
              // this project is the active one.
              const hasSelectedSession = activeView === 'session' && (sessionsByProject.get(project.id) ?? []).some((session) => session.id === activeSessionId)
              return (
                <div className="project-group" key={project.id}>
                  <div
                    className={`project-row${activeProjectId === project.id && activeView === 'session' && activeSessionId !== undefined && !hasSelectedSession ? ' is-selected' : ''}`}
                    onContextMenu={(event) => { event.preventDefault(); setProjectMenu(project.id) }}
                  >
                    <button className="project-row__main" type="button" onClick={() => setCollapsedProjects((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next })}>
                      <Folder size={15} />
                      <span>{project.name}</span>
                    </button>
                    <IconButton size="small" className="project-row__new-session row-action" label={t('sidebar.newSessionIn', { project: project.name })} onClick={() => { setProjectMenu(null); onNewSession(project) }}><MessageSquarePlus size={13} /></IconButton>
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
          </div>
        </>
      )}

      {settingsMode ? null : (
        <div className="sidebar__footer">
        <button type="button" className={`sidebar__settings-entry${settingsMode ? ' is-active' : ''}`} onClick={() => onNavigate(settingsMode ? 'session' : 'settings')}><Settings size={15} /><span>{activeProjectName}</span><kbd>{settingsShortcut}</kbd></button>
        <MobileConnectionButton onClick={() => { onNavigate('settings'); onSelectSettingsSection?.('mobile') }} />
        </div>
      )}
      {renameTarget ? <Modal title={t('sidebar.renameTitle')} onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>{t('sidebar.cancel')}</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>{t('sidebar.rename')}</button></>}><label className="field"><span>{t('sidebar.sessionName')}</span><input autoFocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {removeTarget ? <Modal title={t('sidebar.removeProject')} onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>{t('sidebar.cancel')}</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>{t('sidebar.remove')}</button></>}><p>{t('sidebar.removeConfirm', { name: removeTarget.name, harness: HARNESS_PRODUCT_NAMES[activeHarness] })}</p></Modal> : null}

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
    && previous.onSelectHarness === next.onSelectHarness
    && previous.onSelectProject === next.onSelectProject
    && previous.onSelectSession === next.onSelectSession
    && previous.onNavigate === next.onNavigate
    && previous.onNewSession === next.onNewSession
    && previous.onAddProject === next.onAddProject
    && previous.onRemoveProject === next.onRemoveProject
    && previous.onOpenPalette === next.onOpenPalette
  && previous.onRenameSession === next.onRenameSession
  && previous.onArchiveSession === next.onArchiveSession
  && previous.settingsMode === next.settingsMode
  && previous.searchOpen === next.searchOpen
  && previous.activeSettingsSection === next.activeSettingsSection
  && previous.onSelectSettingsSection === next.onSelectSettingsSection
    && previous.platform === next.platform
  && previous.schedulesAttention === next.schedulesAttention
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
