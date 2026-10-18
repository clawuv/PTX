import { ArrowDownToLine, File, FileCode2, GitBranch, LoaderCircle, RefreshCw, Sparkles, Undo2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { GitStatus } from '@/types/api'
import { boundLines } from '@/lib/render-bounds'
import { EmptyState, IconButton, Modal, Segmented } from '../ui'

interface AheadCommit { hash: string; subject: string; date: string }

const MAX_RENDERED_DIFF_CHARACTERS = 2 * 1024 * 1024
const MAX_RENDERED_DIFF_LINES = 4_000

function generateCommitSummary(files: GitStatus['files']): string {
  if (!files.length) return ''
  const verbs = new Set(files.map((file) => file.status[0]))
  const verb = verbs.size === 1 && verbs.has('A') ? 'Add' : verbs.size === 1 && verbs.has('D') ? 'Remove' : 'Update'
  const names = files.map((file) => file.path)
  const description = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, names.length === 2 ? ' and $1' : ', and $1') : `${names.length} files`
  return `${verb} ${description}`
}

function DiffView({ text }: { text: string }) {
  const { t } = useI18n()
  if (!text) return <div className="diff-placeholder"><FileCode2 size={22} /><span>{t('changes.diff.placeholder')}</span></div>
  const { lines, truncated } = boundLines(text, MAX_RENDERED_DIFF_CHARACTERS, MAX_RENDERED_DIFF_LINES)
  return <pre className="diff-view">{lines.map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-line diff-line--add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-line diff-line--remove' : line.startsWith('@@') ? 'diff-line diff-line--hunk' : 'diff-line'}><i>{index + 1}</i><code>{line || ' '}</code></span>)}{truncated ? <span className="diff-line diff-line--truncated"><i>…</i><code>{t('changes.diff.truncated')}</code></span> : null}</pre>
}

export function ChangesPanel({ cwd, git, readOnly = false, onGrantProject, onRefreshGit }: { cwd?: string; git: GitStatus; readOnly?: boolean; onGrantProject?(): Promise<void> | void; onRefreshGit(): Promise<void> | void }) {
  const { t } = useI18n()
  const [scope, setScope] = useState<'unstaged' | 'staged'>('unstaged')
  const [selectedPath, setSelectedPath] = useState<string | undefined>(git.files[0]?.path)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [pushing, setPushing] = useState(false)
  const [aheadOpen, setAheadOpen] = useState(false)
  const [aheadList, setAheadList] = useState<AheadCommit[]>([])
  const [undoingHash, setUndoingHash] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const visibleFiles = git.files.filter((file) => scope === 'staged' ? file.staged : !file.staged)
  const activeSelectedPath = visibleFiles.some((file) => file.path === selectedPath) ? selectedPath : undefined

  useEffect(() => {
    if (!visibleFiles.some((file) => file.path === selectedPath)) setSelectedPath(visibleFiles[0]?.path)
  }, [git.files, scope, selectedPath])

  useEffect(() => {
    if (!cwd || !activeSelectedPath || !window.ptx) {
      setDiff(activeSelectedPath ? `diff --git a/${activeSelectedPath} b/${activeSelectedPath}
--- a/${activeSelectedPath}
+++ b/${activeSelectedPath}
@@ -18,3 +18,6 @@
 const workspace = createWorkspace()
+workspace.open()
+workspace.focus()
 return workspace` : '')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    window.ptx.git.diff(cwd, activeSelectedPath, scope === 'staged').then((value) => { if (!cancelled) setDiff(value.text) }).catch(() => { if (!cancelled) setDiff(t('changes.error.loadDiff')) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd, activeSelectedPath, scope])

  const mutate = async (kind: 'stage' | 'unstage' | 'restore', paths: string[]): Promise<boolean> => {
    if (readOnly || !cwd || !window.ptx) return false
    setActionError('')
    try {
      const ok = kind === 'stage'
        ? await window.ptx.git.stage(cwd, paths)
        : kind === 'unstage'
          ? await window.ptx.git.unstage(cwd, paths)
          : await window.ptx.git.restore(cwd, paths)
      if (!ok) throw new Error(t('changes.error.mutate', { action: kind, count: paths.length }))
      await onRefreshGit()
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    }
  }

  const fillCommitSummary = () => {
    setActionError('')
    setCommitMessage(generateCommitSummary(visibleFiles))
  }

  /** One flow for both scopes: unstaged listings are staged first, then the modal message commits. */
  const commit = async () => {
    if (readOnly || !cwd || !window.ptx || !commitMessage.trim() || !visibleFiles.length) return
    setActionError('')
    try {
      if (scope === 'unstaged') {
        const staged = await window.ptx.git.stage(cwd, visibleFiles.map((file) => file.path))
        if (!staged) throw new Error(t('changes.error.mutate', { action: 'stage', count: visibleFiles.length }))
      }
      const result = await window.ptx.git.commit(cwd, commitMessage.trim())
      if (!result.ok) throw new Error(result.output || t('changes.error.commit'))
      setCommitOpen(false); setCommitMessage(''); await onRefreshGit()
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  const pushCommits = async () => {
    if (readOnly || !cwd || !window.ptx || pushing) return
    setActionError('')
    setPushing(true)
    try {
      const result = await window.ptx.git.push(cwd)
      if (!result.ok) throw new Error(result.output || t('changes.error.push'))
      await onRefreshGit()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPushing(false)
    }
  }

  const toggleAhead = async () => {
    setActionError('')
    if (aheadOpen) { setAheadOpen(false); return }
    setAheadOpen(true)
    if (!cwd || !window.ptx) return
    try { setAheadList(await window.ptx.git.aheadCommits(cwd)) } catch { setAheadList([]) }
  }

  /** Soft-resets to the commit's parent, so it and any newer unpushed commits return to the staged index. */
  const undoAheadCommit = async (hash: string) => {
    if (readOnly || !cwd || !window.ptx || undoingHash) return
    setActionError('')
    setUndoingHash(hash)
    try {
      const result = await window.ptx.git.undoCommit(cwd, hash)
      if (!result.ok) throw new Error(result.output || t('changes.error.undoCommit'))
      setAheadList((list) => list.slice(list.findIndex((entry) => entry.hash === hash) + 1))
      await onRefreshGit()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setUndoingHash(null)
    }
  }

  useEffect(() => {
    if (!aheadOpen) return
    const dismiss = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || popoverRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.ahead-toggle')) return
      setAheadOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAheadOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [aheadOpen])

  if (!git.isRepo) return <EmptyState icon={<GitBranch size={24} />} title={t('changes.empty.title')}>{t('changes.empty.description')}</EmptyState>
  if (git.error) {
    return <EmptyState
      icon={<GitBranch size={24} />}
      title={t('changes.error.status.title')}
      action={<button type="button" className="button" onClick={() => void onRefreshGit()}><RefreshCw size={13} /> {t('changes.action.tryAgain')}</button>}
    >{git.error}</EmptyState>
  }
  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div><strong><GitBranch size={13} /> {git.branch ?? t('changes.branch.fallback')}</strong>{git.ahead ? <button type="button" className="ahead-toggle" aria-expanded={aheadOpen} onClick={() => void toggleAhead()}>{t('changes.ahead', { count: git.ahead })}</button> : null}</div>
        <div className="changes-toolbar__actions">
          {git.ahead ? <IconButton label={t('changes.action.push')} disabled={pushing} onClick={() => void pushCommits()}><Upload size={14} /></IconButton> : null}
          <IconButton label={t('changes.action.refresh')} onClick={() => void onRefreshGit()}><RefreshCw size={14} /></IconButton>
        </div>
      </div>
      {aheadOpen && git.ahead ? <div ref={popoverRef} className="ahead-popover" role="group" aria-label={t('changes.ahead.title')}>
        <div className="ahead-popover__heading">{t('changes.ahead.title')}</div>
        {aheadList.length ? aheadList.map((entry) => <div key={entry.hash}>
          <span className="ahead-popover__hash">{entry.hash.slice(0, 7)}</span>
          <span className="ahead-popover__subject" title={entry.subject}>{entry.subject}</span>
          <button type="button" disabled={readOnly || undoingHash !== null} onClick={() => void undoAheadCommit(entry.hash)}>{t('changes.action.undoCommit')}</button>
        </div>) : <p className="ahead-popover__empty">{t('changes.ahead.loading')}</p>}
      </div> : null}
      {readOnly ? <div className="changes-read-only" role="note"><span>{t('changes.readOnly.notice')}</span>{onGrantProject ? <button type="button" className="button button--compact" onClick={() => void onGrantProject()}>{t('changes.action.addProject')}</button> : null}</div> : null}
      <div className="changes-scopes"><Segmented value={scope} label={t('changes.scope.label')} options={[{ value: 'unstaged', label: t('changes.scope.unstaged') }, { value: 'staged', label: t('changes.scope.staged') }]} onChange={(value) => { setActionError(''); setScope(value as 'unstaged' | 'staged') }} /><button type="button" className="button button--compact" disabled={readOnly || !visibleFiles.length} onClick={() => setCommitOpen(true)}>{t('changes.action.commit')}</button></div>
      {actionError ? <p className="changes-error" role="alert">{actionError}</p> : null}
      <div className="changes-body">
        <div className="file-changes scroll-area">
          <div className="file-changes__header"><span>{t('changes.count', { count: visibleFiles.length })}</span>{visibleFiles.length ? <button type="button" disabled={readOnly} onClick={() => void mutate(scope === 'staged' ? 'unstage' : 'stage', visibleFiles.map((file) => file.path))}>{scope === 'staged' ? t('changes.action.unstageAll') : t('changes.action.stageAll')}</button> : null}</div>
          {visibleFiles.map((file) => <button type="button" key={file.path} className={selectedPath === file.path ? 'is-selected' : ''} onClick={() => setSelectedPath(file.path)}><File size={13} /><span title={file.path}>{file.path}</span><small className="additions">+{file.additions}</small><small className="deletions">−{file.deletions}</small><span className="file-status">{file.status}</span></button>)}
          {visibleFiles.length === 0 ? <p className="file-changes__empty">{scope === 'staged' ? t('changes.empty.staged') : t('changes.empty.unstaged')}</p> : null}
        </div>
        <div className="diff-pane scroll-area">
          {selectedPath ? <div className="diff-header"><div><span title={selectedPath}>{selectedPath.split('/').pop()}</span></div><div>{scope === 'unstaged' ? <button type="button" disabled={readOnly} onClick={() => void mutate('stage', [selectedPath])}><ArrowDownToLine size={12} /> {t('changes.action.stage')}</button> : <button type="button" disabled={readOnly} onClick={() => void mutate('unstage', [selectedPath])}><Undo2 size={12} /> {t('changes.action.unstage')}</button>}<button type="button" className="danger-action" disabled={readOnly} onClick={() => setConfirmUndo(selectedPath)}><Undo2 size={12} /> {t('changes.action.undo')}</button></div></div> : null}
          {loading ? <div className="diff-loading"><LoaderCircle className="spin" size={15} /> {t('changes.diff.loading')}</div> : <DiffView text={diff} />}
        </div>
      </div>
      {commitOpen ? <Modal title={t('changes.commit.title')} onClose={() => setCommitOpen(false)} footer={<><button className="button" type="button" onClick={() => setCommitOpen(false)}>{t('changes.action.cancel')}</button><button className="button button--primary" type="button" disabled={readOnly || !commitMessage.trim()} onClick={() => void commit()}>{t('changes.commit.action')}</button></>}><label className="field"><span>{t('changes.commit.message')}</span><div className="commit-message-input"><input autoFocus value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t('changes.commit.placeholder')} /><button type="button" className="button button--compact" onClick={fillCommitSummary} title={t('changes.commit.generateTitle')}><Sparkles size={13} /> {t('changes.commit.generate')}</button></div></label><p className="muted-copy">{t('changes.commit.body.before')}<code>{git.branch}</code>{t('changes.commit.body.after')}</p></Modal> : null}
      {confirmUndo ? <Modal title={t('changes.undo.title')} onClose={() => setConfirmUndo(null)} footer={<><button className="button" type="button" onClick={() => setConfirmUndo(null)}>{t('changes.action.cancel')}</button><button className="button button--danger" type="button" disabled={readOnly} onClick={() => { const path = confirmUndo; void mutate('restore', [path]).then((ok) => { if (ok) setConfirmUndo(null) }) }}>{t('changes.action.undo')}</button></>}><p>{t('changes.undo.body.before')}<code>{confirmUndo}</code>{t('changes.undo.body.after')}</p></Modal> : null}
    </div>
  )
}
