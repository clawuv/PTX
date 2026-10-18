import { Folder, PanelRight } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { GitWorktree, OpenWithTargetId, ProjectRecord, SessionRecord } from '@/types/api'
import { SummaryPopover } from './SummaryPopover'

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
  inspectorOpen?: boolean
  onToggleInspector?(): void
  /** Availability probe for the open-with launcher; without it the summary row stays hidden. */
  onOpenWithTargets?(): Promise<OpenWithTargetId[]>
  onOpenWith?(target: OpenWithTargetId): void
  /** Local branch list for the project menu's switcher; without it the section stays hidden. */
  onBranches?(): Promise<string[]>
  onSwitchBranch?(branch: string): Promise<void> | void
}

/**
 * The conversation pane's sticky header: the active session title on the left,
 * the summary popover (environment plus open-with) and the floating pane
 * actions on the right. Session actions live in the sidebar's per-session menu.
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
  inspectorOpen,
  onToggleInspector,
  onOpenWithTargets,
  onOpenWith,
  onBranches,
  onSwitchBranch,
}: ConversationHeaderProps) {
  const { t } = useI18n()

  const fullTitle = session?.title ?? project?.name ?? t('sidebar.newSession')
  const HEADER_TITLE_MAX = 25
  const title = fullTitle.length > HEADER_TITLE_MAX ? `${fullTitle.slice(0, HEADER_TITLE_MAX)}…` : fullTitle

  return (
    <header className={`conversation-header drag-region${session ? '' : ' conversation-header--new'}`}>
      {session ? (
        <div className="conversation-header__title-row" title={fullTitle}>
          <Folder size={14} className="conversation-header__icon" aria-hidden="true" />
          <span className="conversation-header__title">{title}</span>
        </div>
      ) : null}
      <span className="conversation-header__spacer" />
      <SummaryPopover
        checkoutLabel={checkoutLabel}
        worktrees={worktrees}
        activeWorktreePath={activeWorktreePath}
        worktreesLoading={worktreesLoading}
        onOpenWorktree={onOpenWorktree}
        onCreateWorktree={onCreateWorktree}
        onOpenWithTargets={onOpenWithTargets}
        onOpenWith={onOpenWith}
        onBranches={onBranches}
        onSwitchBranch={onSwitchBranch}
      />
      <button
        type="button"
        className={`summary-anchor__trigger ${inspectorOpen ? 'is-active' : ''}`}
        aria-label={t('pane.toggleInspector')}
        data-tooltip={t('pane.toggleInspector')}
        aria-pressed={inspectorOpen}
        onClick={() => onToggleInspector?.()}
      >
        <PanelRight size={15} />
      </button>
    </header>
  )
}
