import { ChevronRight, File, FileSearch, LoaderCircle, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { GitStatus } from '@/types/api'
import { Modal } from './ui'

interface ChangesCardProps {
  git: GitStatus
  /** Repository working directory; the undo action stays hidden without one. */
  cwd?: string
  readOnly?: boolean
  onOpenChanges(): void
  onRefreshGit?(): Promise<void> | void
}

export function ChangesCard({ git, cwd, readOnly = false, onOpenChanges, onRefreshGit }: ChangesCardProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [undoError, setUndoError] = useState('')
  const [undoBusy, setUndoBusy] = useState(false)
  const additions = git.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = git.files.reduce((sum, file) => sum + file.deletions, 0)

  const undoAll = async () => {
    if (readOnly || !cwd || !window.ptx || undoBusy) return
    setUndoBusy(true)
    setUndoError('')
    try {
      const ok = await window.ptx.git.restore(cwd, git.files.map((file) => file.path))
      if (!ok) throw new Error(t('changescard.undoFailed'))
      setConfirmUndo(false)
      await onRefreshGit?.()
    } catch (error) {
      setUndoError(errorMessage(error))
    } finally {
      setUndoBusy(false)
    }
  }

  return (
    <div className={`changes-card${expanded ? ' is-expanded' : ''}`}>
      <div className="changes-card__summary">
        <button
          type="button"
          className="changes-card__expand"
          aria-expanded={expanded}
          aria-label={expanded ? t('changescard.hide') : t('changescard.show')}
          title={expanded ? t('changescard.hide') : t('changescard.show')}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronRight size={14} className="changes-card__chevron" aria-hidden="true" />
        </button>
        <button type="button" className="changes-card__open" onClick={() => setExpanded((open) => !open)}>
          <strong>{t('changescard.filesChanged', { count: git.files.length })}</strong>
          <span className="diff-count diff-count--add">+{additions}</span>
          <span className="diff-count diff-count--remove">−{deletions}</span>
        </button>
        <button type="button" className="changes-card__review" onClick={onOpenChanges}>
          <FileSearch size={13} aria-hidden="true" /> {t('changescard.reviewAction')}
        </button>
        <button
          type="button"
          className="changes-card__undo"
          disabled={readOnly || !cwd}
          title={t('changescard.undoHint')}
          onClick={() => setConfirmUndo(true)}
        >
          <Undo2 size={13} aria-hidden="true" /> {t('changescard.undo')}
        </button>
      </div>
      {expanded ? (
        <ul className="changes-card__files" aria-label={t('changescard.filesRegion')}>
          {git.files.map((file) => (
            <li key={file.path} title={file.path}>
              <File size={12} aria-hidden="true" />
              <span>{file.path}</span>
              <small className="diff-count diff-count--add">+{file.additions}</small>
              <small className="diff-count diff-count--remove">−{file.deletions}</small>
              <em>{file.status}</em>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmUndo ? (
        <Modal title={t('changescard.undoTitle')} onClose={() => setConfirmUndo(false)} footer={
          <>
            <button className="button" type="button" onClick={() => setConfirmUndo(false)}>{t('changes.action.cancel')}</button>
            <button className="button button--danger" type="button" disabled={readOnly || undoBusy} onClick={() => void undoAll()}>
              {undoBusy ? <LoaderCircle className="spin" size={12} /> : null} {t('changescard.undo')}
            </button>
          </>
        }>
          <p>{t('changescard.undoBody', { count: git.files.length })}</p>
          {undoError ? <p className="changes-error" role="alert">{undoError}</p> : null}
        </Modal>
      ) : null}
    </div>
  )
}
