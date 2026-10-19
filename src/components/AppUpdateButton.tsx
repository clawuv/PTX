import { Download, RefreshCw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { AppUpdateState } from '@/types/api'
import { useI18n, type MessageKey, type MessageValues } from '@/lib/i18n'
import { Modal } from './ui'

type Translate = (key: MessageKey, values?: MessageValues) => string

function updateControlCopy(state: AppUpdateState, t: Translate): { label: string; title: string } {
  const version = state.version ? ` ${state.version}` : ''
  if (state.manualInstall && (state.phase === 'available' || state.phase === 'downloaded')) return { label: t('sidebar.update.manualDownload'), title: t('sidebar.update.manualDownload') }
  switch (state.phase) {
    case 'idle':
      return { label: t('menu.checkForUpdates'), title: t('menu.checkForUpdates') }
    case 'checking':
      return { label: t('sidebar.update.checking'), title: t('sidebar.update.checkingTitle') }
    case 'available':
      return { label: t('sidebar.update.download', { version }), title: t('sidebar.update.downloadTitle', { version }) }
    case 'downloading':
      return {
        label: state.percent === undefined ? t('sidebar.update.downloading', { version }) : t('sidebar.update.downloadingPercent', { version, percent: state.percent }),
        title: t('sidebar.update.downloadingTitle', { version }),
      }
    case 'downloaded':
      return { label: t('sidebar.update.restartFor', { version }), title: t('sidebar.update.restartTitle', { version }) }
    case 'not-available':
      return { label: t('sidebar.update.upToDate'), title: t('sidebar.update.checkAgain') }
    case 'error':
      return { label: t('sidebar.update.retry', { version }), title: state.message ?? t('sidebar.update.errorTitle') }
    case 'unsupported':
      return { label: t('sidebar.update.automatic'), title: state.message ?? t('sidebar.update.unsupportedTitle') }
    default:
      return { label: t('sidebar.update.releaseUpdates'), title: t('sidebar.update.releaseTitle') }
  }
}

/** Announced without the percentage so progress ticks do not spam assistive tech. */
function updateAnnouncement(state: AppUpdateState, t: Translate): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'available':
      return t('sidebar.update.availableAnnouncement', { version })
    case 'downloading':
      return t('sidebar.update.downloadingAnnouncement', { version })
    case 'downloaded':
      return t('sidebar.update.readyAnnouncement', { version })
    case 'error':
      return t('sidebar.update.failedAnnouncement', { message: state.message ?? t('sidebar.update.tryAgain') })
    default:
      return ''
  }
}

function updateConfirmCopy(state: AppUpdateState, t: Translate): { title: string; body: string } {
  if (state.manualInstall) return { title: t('sidebar.update.manualDownload'), body: t('sidebar.update.manualBody') }
  if (state.phase === 'downloaded')
    return {
      title: t('sidebar.update.confirmRestartTitle'),
      body: t('sidebar.update.confirmRestartBody'),
    }
  return {
    title: t('sidebar.update.confirmDownloadTitle'),
    body: t('sidebar.update.confirmDownloadBody'),
  }
}

/** Always-rendered strip icon: neutral (search-like) until an update exists, blue badge afterwards. */
export function AppUpdateButton({ updateState, onUpdateAction }: { updateState: AppUpdateState; onUpdateAction?(): void | Promise<void> }) {
  const { t } = useI18n()
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const updateCopy = updateControlCopy(updateState, t)
  const updateConfirm = updateConfirmCopy(updateState, t)
  const updateBusy = updateState.phase === 'checking' || updateState.phase === 'downloading'
  const updateIndeterminate = updateState.phase === 'downloading' && updateState.percent === undefined
  // The blue circle badge appears only once a real update exists; every other
  // phase renders the plain 13px glyph so the strip keeps one quiet rhythm.
  const badge = updateState.phase === 'available' || updateState.phase === 'downloading' || updateState.phase === 'downloaded'
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {updateAnnouncement(updateState, t)}
      </span>
      <button
        type="button"
        className={`app-update app-update--${updateState.phase} ${updateIndeterminate ? 'app-update--indeterminate' : ''}`}
        title={updateCopy.title}
        aria-label={updateCopy.title}
        disabled={updateBusy || updateState.phase === 'unsupported' || !onUpdateAction}
        onClick={() => {
          if (updateState.phase === 'available' || updateState.phase === 'downloaded') setConfirmUpdate(true)
          else if (!updateBusy) void onUpdateAction?.()
        }}
        style={{ '--update-progress': `${updateState.percent ?? 0}%` } as CSSProperties}
      >
        {badge ? (
          <span className="app-update__icon">
            <Download size={11} />
          </span>
        ) : (
          <RefreshCw size={13} />
        )}
        <span className="sr-only">{updateCopy.label}</span>
      </button>
      {confirmUpdate ? (
        <Modal
          title={updateConfirm.title}
          onClose={() => setConfirmUpdate(false)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setConfirmUpdate(false)}>
                {t('sidebar.update.confirmNo')}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setConfirmUpdate(false)
                  void onUpdateAction?.()
                }}
              >
                {t('sidebar.update.confirmYes')}
              </button>
            </>
          }
        >
          <p>{updateConfirm.body}</p>
        </Modal>
      ) : null}
    </>
  )
}
