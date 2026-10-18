import { Check, ChevronDown, Code, FolderGit2, FolderOpen, GitBranch, ListChecks, LoaderCircle, SquareCode, Terminal as TerminalIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { GitWorktree, OpenWithTargetId } from '@/types/api'

const OPEN_WITH_ITEMS: Array<{ id: OpenWithTargetId; label: string; icon: React.ReactNode }> = [
  { id: 'explorer', label: 'header.openWithExplorer', icon: <FolderOpen size={12} aria-hidden="true" /> },
  { id: 'vscode', label: 'VS Code', icon: <Code size={12} aria-hidden="true" /> },
  { id: 'cursor', label: 'Cursor', icon: <SquareCode size={12} aria-hidden="true" /> },
  { id: 'terminal', label: 'header.openWithTerminal', icon: <TerminalIcon size={12} aria-hidden="true" /> },
]

interface SummaryPopoverProps {
  /** Branch/worktree name shown on the checkout row. */
  checkoutLabel?: string
  worktrees: GitWorktree[]
  activeWorktreePath?: string
  worktreesLoading: boolean
  /** Opens a linked worktree (grant + new session); without it the list is display-only. */
  onOpenWorktree?(worktree: GitWorktree): Promise<void> | void
  /** Creates a linked worktree on a new branch and opens it. */
  onCreateWorktree?(branch: string): Promise<void> | void
  /** Availability probe for the open-with launcher; without it the summary row stays hidden. */
  onOpenWithTargets?(): Promise<OpenWithTargetId[]>
  onOpenWith?(target: OpenWithTargetId): void
  /** Local branch list for the switcher; without it the section stays hidden. */
  onBranches?(): Promise<string[]>
  onSwitchBranch?(branch: string): Promise<void> | void
  /** Creates a new local branch at HEAD without switching to it. */
  onCreateBranch?(branch: string): Promise<void> | void
}

/**
 * The composer's summary popover: environment details (project, checkout,
 * worktrees) collapse behind one corner trigger so the composer stays a single
 * clean input card.
 */
export function SummaryPopover({ checkoutLabel, worktrees, activeWorktreePath, worktreesLoading, onOpenWorktree, onCreateWorktree, onOpenWithTargets, onOpenWith, onBranches, onSwitchBranch, onCreateBranch }: SummaryPopoverProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [branch, setBranch] = useState('')
  const [branchError, setBranchError] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [worktreeSectionOpen, setWorktreeSectionOpen] = useState(false)
  const [worktreeName, setWorktreeName] = useState('')
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [worktreeError, setWorktreeError] = useState('')
  const [openWithOpen, setOpenWithOpen] = useState(false)
  const [openWithTargets, setOpenWithTargets] = useState<OpenWithTargetId[] | null>(null)
  const [branchNames, setBranchNames] = useState<string[] | null>(null)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState('')
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
  const checkoutName = activeWorktree?.branch ?? activeWorktree?.name ?? checkoutLabel ?? t('composer.worktree.checkout')
  const createBranch = async () => {
    const name = branch.trim()
    if (!name || !onCreateBranch || creatingBranch) return
    setCreatingBranch(true)
    setBranchError('')
    try {
      await onCreateBranch(name)
      setBranch('')
      // Surface the new branch in the switcher immediately.
      if (onBranches) {
        try {
          setBranchNames(await onBranches())
        } catch {
          // Keep the previous list when a refresh fails.
        }
      }
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : t('composer.worktree.createError'))
    } finally {
      setCreatingBranch(false)
    }
  }

  const createWorktree = async () => {
    const name = worktreeName.trim()
    if (!name || !onCreateWorktree || creatingWorktree) return
    setCreatingWorktree(true)
    setWorktreeError('')
    try {
      await onCreateWorktree(name)
      setWorktreeName('')
      setWorktreeSectionOpen(false)
      setOpen(false)
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : t('composer.worktree.createWorktreeError'))
    } finally {
      setCreatingWorktree(false)
    }
  }

  const toggleOpenWith = async () => {
    const next = !openWithOpen
    setOpenWithOpen(next)
    if (next && onOpenWithTargets && openWithTargets === null) setOpenWithTargets(await onOpenWithTargets())
  }

  const toggleCheckout = async () => {
    const next = !branchOpen
    setBranchOpen(next)
    if (next && onBranches && branchNames === null) {
      try {
        setBranchNames(await onBranches())
      } catch {
        setBranchNames([])
      }
    }
  }

  const switchBranch = async (branch: string) => {
    if (!onSwitchBranch || switchingBranch) return
    setSwitchingBranch(branch)
    setSwitchError('')
    try {
      await onSwitchBranch(branch)
      setBranchOpen(false)
      setOpen(false)
    } catch (error) {
      setSwitchError(errorMessage(error))
    } finally {
      setSwitchingBranch(null)
    }
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
          <div className="summary-popover__section">
            <button
              type="button"
              className="summary-popover__row summary-popover__row--action"
              aria-label={t('composer.worktree.checkoutAria', { name: checkoutName })}
              aria-expanded={branchOpen}
              aria-controls={branchOpen ? `${panelId}-worktrees` : undefined}
              onClick={() => void toggleCheckout()}
            >
              <GitBranch size={13} aria-hidden="true" />
              <span className="summary-popover__label">{checkoutName}</span>
              <ChevronDown size={12} className={`summary-popover__chevron ${branchOpen ? 'is-open' : ''}`} aria-hidden="true" />
            </button>
            {branchOpen ? (
              <div id={`${panelId}-worktrees`} className="summary-popover__worktrees" role="menu" aria-label={t('composer.worktree.menuAria')}>
                {onSwitchBranch && onBranches ? (
                  <>
                    <div className="worktree-picker__heading">{t('composer.branches.title')}</div>
                    <div className="worktree-picker__options">
                      {branchNames === null ? (
                        <span className="worktree-picker__empty">{t('composer.worktree.loading')}</span>
                      ) : branchNames.length === 0 ? (
                        <span className="worktree-picker__empty">{t('composer.worktree.empty')}</span>
                      ) : (
                        branchNames.map((name) => {
                          const current = name === checkoutLabel
                          const busy = switchingBranch === name
                          return (
                            <button
                              type="button"
                              key={name}
                              role="menuitemradio"
                              aria-checked={current}
                              className={`worktree-picker__option ${current ? 'is-active' : ''}`}
                              disabled={switchingBranch !== null}
                              onClick={() => void switchBranch(name)}
                            >
                              <span className="worktree-picker__check">{current ? <Check size={13} /> : busy ? <LoaderCircle className="spin" size={13} /> : null}</span>
                              <span className="worktree-picker__option-copy">
                                <strong>{name}</strong>
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                    {switchError ? <span className="summary-popover__error" role="alert">{switchError}</span> : null}
                  </>
                ) : null}
                {onCreateBranch ? (
                  <form
                    className="worktree-picker__create"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void createBranch()
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
                      <button type="submit" disabled={!branch.trim() || creatingBranch}>
                        {creatingBranch ? t('composer.worktree.creating') : t('composer.worktree.createButton')}
                      </button>
                    </div>
                    {branchError ? <span role="alert">{branchError}</span> : null}
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
          {onOpenWorktree ? (
            <div className="summary-popover__section">
              <button
                type="button"
                className="summary-popover__row summary-popover__row--action"
                aria-label={t('composer.worktree.sectionTitle')}
                aria-expanded={worktreeSectionOpen}
                aria-controls={worktreeSectionOpen ? `${panelId}-worktree-section` : undefined}
                onClick={() => setWorktreeSectionOpen((value) => !value)}
              >
                <FolderGit2 size={13} aria-hidden="true" />
                <span className="summary-popover__label">{t('composer.worktree.sectionTitle')}</span>
                <ChevronDown size={12} className={`summary-popover__chevron ${worktreeSectionOpen ? 'is-open' : ''}`} aria-hidden="true" />
              </button>
              {worktreeSectionOpen ? (
                <div id={`${panelId}-worktree-section`} className="summary-popover__worktrees" role="menu" aria-label={t('composer.worktree.sectionTitle')}>
                  <div className="worktree-picker__heading">{t('composer.worktree.heading')}</div>
                  <div className="worktree-picker__options">
                    {worktreesLoading ? (
                      <span className="worktree-picker__empty">{t('composer.worktree.loading')}</span>
                    ) : worktrees.length === 0 ? (
                      <span className="worktree-picker__empty">{t('composer.worktree.emptyWorktrees')}</span>
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
                              setOpen(false)
                              setBranchOpen(false)
                              setWorktreeSectionOpen(false)
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
                      <label htmlFor={`${panelId}-worktree-branch`}>{t('composer.worktree.createWorktree')}</label>
                      <div>
                        <input
                          id={`${panelId}-worktree-branch`}
                          value={worktreeName}
                          placeholder={t('composer.worktree.namePlaceholder')}
                          onChange={(event) => {
                            setWorktreeName(event.target.value)
                            setWorktreeError('')
                          }}
                        />
                        <button type="submit" disabled={!worktreeName.trim() || creatingWorktree}>
                          {creatingWorktree ? t('composer.worktree.creating') : t('composer.worktree.createButton')}
                        </button>
                      </div>
                      {worktreeError ? <span role="alert">{worktreeError}</span> : null}
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
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
                            <strong>{item.id === 'vscode' || item.id === 'cursor' ? item.label : t(item.label)}</strong>
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
