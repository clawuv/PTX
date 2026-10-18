import { Check, ChevronDown, Code, Folder, FolderOpen, GitBranch, ListChecks, Monitor, SquareCode } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { GitWorktree, OpenWithTargetId } from '@/types/api'

const OPEN_WITH_ITEMS: Array<{ id: OpenWithTargetId; label: string; icon: React.ReactNode }> = [
  { id: 'explorer', label: 'header.openWithExplorer', icon: <FolderOpen size={12} aria-hidden="true" /> },
  { id: 'vscode', label: 'VS Code', icon: <Code size={12} aria-hidden="true" /> },
  { id: 'cursor', label: 'Cursor', icon: <SquareCode size={12} aria-hidden="true" /> },
]

interface SummaryPopoverProps {
  projectName?: string
  /** Branch/worktree name shown before or without the linked-worktree catalog. */
  checkoutLabel?: string
  worktrees: GitWorktree[]
  activeWorktreePath?: string
  worktreesLoading: boolean
  onOpenWorktree?(worktree: GitWorktree): Promise<void> | void
  onCreateWorktree?(branch: string): Promise<void> | void
  /** Availability probe for the open-with launcher; without it the summary row stays hidden. */
  onOpenWithTargets?(): Promise<OpenWithTargetId[]>
  onOpenWith?(target: OpenWithTargetId): void
}

/**
 * The composer's summary popover: environment details (project, checkout,
 * worktrees) collapse behind one corner trigger so the composer stays a single
 * clean input card.
 */
export function SummaryPopover({ projectName, checkoutLabel, worktrees, activeWorktreePath, worktreesLoading, onOpenWorktree, onCreateWorktree, onOpenWithTargets, onOpenWith }: SummaryPopoverProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [branch, setBranch] = useState('')
  const [branchError, setBranchError] = useState('')
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [openWithOpen, setOpenWithOpen] = useState(false)
  const [openWithTargets, setOpenWithTargets] = useState<OpenWithTargetId[] | null>(null)
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Drag regions swallow mouse events, so mark the body to let outside header
    // clicks reach the page and dismiss the popover (see base.css).
    document.body.classList.add('has-header-popover')
    const dismiss = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.summary-anchor__trigger')) return
      setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.body.classList.remove('has-header-popover')
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  const activeWorktree = worktrees.find((worktree) => worktree.path === activeWorktreePath) ?? worktrees.find((worktree) => worktree.current)
  const worktreeLabel = activeWorktree?.branch ?? activeWorktree?.name ?? checkoutLabel ?? t('composer.worktree.checkout')
  const createWorktree = async () => {
    const name = branch.trim()
    if (!name || !onCreateWorktree || creatingWorktree) return
    setCreatingWorktree(true)
    setBranchError('')
    try {
      await onCreateWorktree(name)
      setBranch('')
      setBranchOpen(false)
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : t('composer.worktree.createError'))
    } finally {
      setCreatingWorktree(false)
    }
  }

  const toggleOpenWith = async () => {
    const next = !openWithOpen
    setOpenWithOpen(next)
    if (next && onOpenWithTargets && openWithTargets === null) setOpenWithTargets(await onOpenWithTargets())
  }

  return (
    <div className="summary-anchor">
      <button
        type="button"
        className="summary-anchor__trigger"
        aria-label={t('composer.summary.label')}
        data-tooltip={t('composer.summary.label')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <ListChecks size={15} />
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} className="summary-popover" role="group" aria-label={t('composer.summary.aria')}>
          <div className="summary-popover__heading">{t('composer.context.environment')}</div>
          <span className="summary-popover__row" title={projectName ?? checkoutLabel}>
            <Folder size={13} aria-hidden="true" />
            <span className="summary-popover__label">{projectName ?? checkoutLabel ?? '—'}</span>
          </span>
          <span className="summary-popover__row">
            <Monitor size={13} aria-hidden="true" />
            <span className="summary-popover__label">{t('composer.local')}</span>
          </span>
          <div className="summary-popover__section">
            <button
              type="button"
              className="summary-popover__row summary-popover__row--action"
              aria-label={t('composer.worktree.checkoutAria', { name: worktreeLabel })}
              aria-expanded={branchOpen}
              aria-controls={branchOpen ? `${panelId}-worktrees` : undefined}
              onClick={() => setBranchOpen((value) => !value)}
            >
              <GitBranch size={13} aria-hidden="true" />
              <span className="summary-popover__label">{worktreeLabel}</span>
              <ChevronDown size={12} className={`summary-popover__chevron ${branchOpen ? 'is-open' : ''}`} aria-hidden="true" />
            </button>
            {branchOpen ? (
              <div id={`${panelId}-worktrees`} className="summary-popover__worktrees" role="menu" aria-label={t('composer.worktree.menuAria')}>
                <div className="worktree-picker__heading">{t('composer.worktree.heading')}</div>
                <div className="worktree-picker__options">
                  {worktreesLoading ? (
                    <span className="worktree-picker__empty">{t('composer.worktree.loading')}</span>
                  ) : worktrees.length === 0 ? (
                    <span className="worktree-picker__empty">{t('composer.worktree.empty')}</span>
                  ) : (
                    worktrees.map((worktree) => {
                      const selected = worktree.path === activeWorktreePath || (!activeWorktreePath && worktree.current)
                      const label = worktree.branch ?? worktree.name
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`worktree-picker__option ${selected ? 'is-active' : ''}`}
                          key={worktree.path}
                          onClick={() => {
                            setBranchOpen(false)
                            if (selected) return
                            if (onOpenWorktree) void Promise.resolve(onOpenWorktree(worktree)).catch(() => undefined)
                          }}
                        >
                          <span className="worktree-picker__check">{selected ? <Check size={13} /> : null}</span>
                          <span className="worktree-picker__option-copy">
                            <strong>{label}</strong>
                            <span title={worktree.path}>{worktree.path}</span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
                {onCreateWorktree ? (
                  <form
                    className="worktree-picker__create"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void createWorktree()
                    }}
                  >
                    <label htmlFor={`${panelId}-branch`}>{t('composer.worktree.create')}</label>
                    <div>
                      <input
                        id={`${panelId}-branch`}
                        value={branch}
                        placeholder={t('composer.worktree.branchPlaceholder')}
                        onChange={(event) => {
                          setBranch(event.target.value)
                          setBranchError('')
                        }}
                      />
                      <button type="submit" disabled={!branch.trim() || creatingWorktree}>
                        {creatingWorktree ? t('composer.worktree.creating') : t('composer.worktree.createButton')}
                      </button>
                    </div>
                    {branchError ? <span role="alert">{branchError}</span> : null}
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
          {onOpenWith && onOpenWithTargets ? (
            <div className="summary-popover__section">
              <button
                type="button"
                className="summary-popover__row summary-popover__row--action"
                aria-label={t('header.openWith')}
                aria-expanded={openWithOpen}
                aria-controls={openWithOpen ? `${panelId}-openwith` : undefined}
                onClick={() => void toggleOpenWith()}
              >
                <Code size={13} aria-hidden="true" />
                <span className="summary-popover__label">{t('header.openWith')}</span>
                <ChevronDown size={12} className={`summary-popover__chevron ${openWithOpen ? 'is-open' : ''}`} aria-hidden="true" />
              </button>
              {openWithOpen ? (
                <div id={`${panelId}-openwith`} className="summary-popover__worktrees" role="menu" aria-label={t('header.openWith')}>
                  <div className="worktree-picker__options">
                    {openWithTargets === null ? (
                      <span className="worktree-picker__empty">{t('header.openWithLoading')}</span>
                    ) : openWithTargets.length === 0 ? (
                      <span className="worktree-picker__empty">{t('header.openWithNone')}</span>
                    ) : (
                      OPEN_WITH_ITEMS.filter((item) => openWithTargets.includes(item.id)).map((item) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={item.id}
                          className="worktree-picker__option"
                          onClick={() => {
                            setOpenWithOpen(false)
                            setOpen(false)
                            onOpenWith(item.id)
                          }}
                        >
                          <span className="worktree-picker__check">{item.icon}</span>
                          <span className="worktree-picker__option-copy">
                            <strong>{item.id === 'explorer' ? t(item.label) : item.label}</strong>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
