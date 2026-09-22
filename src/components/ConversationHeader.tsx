import { Archive, ChevronRight, Code, Copy, FolderOpen, MessageSquare, MoreHorizontal, PanelRight, SquareCode, SquarePen } from 'lucide-react'
import { type ReactElement, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { GitWorktree, OpenWithTargetId, ProjectRecord, SessionRecord } from '@/types/api'
import { SummaryPopover } from './SummaryPopover'
import { IconButton, Modal } from './ui'

const OPEN_WITH_ITEMS: Array<{ id: OpenWithTargetId; label: string; icon: ReactElement }> = [
  { id: 'explorer', label: 'header.openWithExplorer', icon: <FolderOpen size={12} aria-hidden="true" /> },
  { id: 'vscode', label: 'VS Code', icon: <Code size={12} aria-hidden="true" /> },
  { id: 'cursor', label: 'Cursor', icon: <SquareCode size={12} aria-hidden="true" /> },
]

interface ConversationHeaderProps {
  session?: SessionRecord
  project?: ProjectRecord
  worktrees: GitWorktree[]
  activeWorktreePath?: string
  /** Branch/worktree name shown before or without the linked-worktree catalog. */
  checkoutLabel?: string
  worktreesLoading: boolean
  onOpenWorktree?(worktree: GitWorktree): Promise<void> | void
  onCreateWorktree?(branch: string): Promise<void> | void
  onRename(session: SessionRecord, title: string): Promise<void> | void
  onArchive(session: SessionRecord): Promise<void> | void
  inspectorOpen?: boolean
  onToggleInspector?(): void
  /** Availability probe for the open-with launcher; without it the menu row stays hidden. */
  onOpenWithTargets?(): Promise<OpenWithTargetId[]>
  onOpenWith?(target: OpenWithTargetId): void
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

/**
 * The conversation pane's sticky header: the active session title with its
 * options menu on the left, the summary popover as the first control on the
 * right (before the floating pane actions).
 */
export function ConversationHeader({
  session,
  project,
  worktrees,
  activeWorktreePath,
  checkoutLabel,
  worktreesLoading,
  onOpenWorktree,
  onCreateWorktree,
  onRename,
  onArchive,
  inspectorOpen,
  onToggleInspector,
  onOpenWithTargets,
  onOpenWith,
}: ConversationHeaderProps) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [openWithOpen, setOpenWithOpen] = useState(false)
  const [openWithTargets, setOpenWithTargets] = useState<OpenWithTargetId[] | null>(null)
  const [renameTarget, setRenameTarget] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenWithOpen(false)
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [menuOpen])

  const fullTitle = session?.title ?? project?.name ?? t('sidebar.newSession')
  const HEADER_TITLE_MAX = 20
  const title = fullTitle.length > HEADER_TITLE_MAX ? `${fullTitle.slice(0, HEADER_TITLE_MAX)}…` : fullTitle

  const submitRename = () => {
    const target = session
    const nextTitle = renameValue.trim()
    setRenameTarget(false)
    if (!target || !nextTitle) return
    void onRename(target, nextTitle)
  }

  return (
    <header className={`conversation-header drag-region${session ? '' : ' conversation-header--new'}`}>
      {session ? (
        <>
          <div className="conversation-header__title-row" title={fullTitle}>
            <MessageSquare size={14} className="conversation-header__icon" aria-hidden="true" />
            <span className="conversation-header__title">{title}</span>
          </div>
          <div className="conversation-header__menu-wrap" ref={menuRef}>
            <IconButton size="small" className="conversation-header__more" label={t('sidebar.sessionOptions')} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <MoreHorizontal size={15} />
            </IconButton>
            {menuOpen ? (
              <div className="conversation-header__menu" role="menu" aria-label={t('sidebar.sessionOptions')}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!session}
                  onClick={() => {
                    setMenuOpen(false)
                    if (session) void copySessionUuid(session.id)
                  }}
                >
                  <Copy size={12} /> {t('sidebar.copyUuid')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!session}
                  onClick={() => {
                    setMenuOpen(false)
                    setRenameValue(session?.title ?? '')
                    setRenameTarget(true)
                  }}
                >
                  <SquarePen size={12} /> {t('sidebar.rename')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!session}
                  onClick={() => {
                    setMenuOpen(false)
                    if (session) void onArchive(session)
                  }}
                >
                  <Archive size={12} /> {t('sidebar.archive')}
                </button>
                {onOpenWith && onOpenWithTargets ? (
                  <div className="conversation-header__openwith">
                    <button
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={openWithOpen}
                      onClick={async () => {
                        setOpenWithOpen((value) => !value)
                        if (!openWithOpen && openWithTargets === null) {
                          const targets = await onOpenWithTargets()
                          setOpenWithTargets(targets)
                        }
                      }}
                    >
                      <Code size={12} /> {t('header.openWith')}
                      <ChevronRight size={11} className="conversation-header__submenu-chevron" aria-hidden="true" />
                    </button>
                    {openWithOpen ? (
                      <div className="conversation-header__submenu" role="menu" aria-label={t('header.openWith')}>
                        {openWithTargets === null ? (
                          <span className="conversation-header__submenu-empty">{t('header.openWithLoading')}</span>
                        ) : openWithTargets.length === 0 ? (
                          <span className="conversation-header__submenu-empty">{t('header.openWithNone')}</span>
                        ) : (
                          OPEN_WITH_ITEMS.filter((item) => openWithTargets.includes(item.id)).map((item) => (
                            <button
                              type="button"
                              role="menuitem"
                              key={item.id}
                              onClick={() => {
                                setMenuOpen(false)
                                setOpenWithOpen(false)
                                onOpenWith(item.id)
                              }}
                            >
                              {item.icon} {item.id === 'explorer' ? t('header.openWithExplorer') : item.label}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      <span className="conversation-header__spacer" />
      <SummaryPopover
        projectName={project?.name}
        checkoutLabel={checkoutLabel}
        worktrees={worktrees}
        activeWorktreePath={activeWorktreePath}
        worktreesLoading={worktreesLoading}
        onOpenWorktree={onOpenWorktree}
        onCreateWorktree={onCreateWorktree}
      />
      <button
        type="button"
        className={`summary-anchor__trigger ${inspectorOpen ? 'is-active' : ''}`}
        aria-label={t('pane.toggleInspector')}
        title={t('pane.toggleInspector')}
        aria-pressed={inspectorOpen}
        onClick={() => onToggleInspector?.()}
      >
        <PanelRight size={15} />
      </button>
      {renameTarget && session ? (
        <Modal
          title={t('sidebar.renameTitle')}
          onClose={() => setRenameTarget(false)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setRenameTarget(false)}>
                {t('sidebar.cancel')}
              </button>
              <button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={submitRename}>
                {t('sidebar.rename')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('sidebar.sessionName')}</span>
            <input
              autoFocus
              value={renameValue}
              maxLength={200}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renameValue.trim()) {
                  event.preventDefault()
                  submitRename()
                }
              }}
            />
          </label>
        </Modal>
      ) : null}
    </header>
  )
}
