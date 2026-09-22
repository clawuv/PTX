import { ExternalLink } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { ProviderAuthEvent } from '@/types/api'
import { Modal } from './ui'

interface ProviderAuthModalProps {
  event: Exclude<ProviderAuthEvent, { type: 'cancelled' }>
  onOpen(url: string): void
  onRespond(promptId: string, value?: string): void
  onCancel(): void
}

export function ProviderAuthModal({ event, onOpen, onRespond, onCancel }: ProviderAuthModalProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const selectionLabelId = useId()
  useEffect(() => { setValue('') }, [event.type, 'promptId' in event ? event.promptId : event.flowId])

  const footer = event.type === 'prompt' ? (
    <>
      <button type="button" className="button" onClick={onCancel}>{t('settings.action.cancel')}</button>
      <button type="button" className="button button--primary" disabled={!event.allowEmpty && !value.trim()} onClick={() => onRespond(event.promptId, value)}>{t('authmodal.action.continue')}</button>
    </>
  ) : event.type === 'complete' || event.type === 'error'
    ? <button type="button" className="button button--primary" onClick={onCancel}>{t('authmodal.action.close')}</button>
    : <button type="button" className="button" onClick={onCancel}>{t('authmodal.action.cancelLogin')}</button>

  const title = event.type === 'complete'
    ? t('authmodal.title.success')
    : event.type === 'error'
      ? t('authmodal.title.failed')
      : t('authmodal.title.connect')

  return (
    <Modal title={title} onClose={onCancel} footer={footer}>
      {event.type === 'auth' ? <div className="provider-auth-step"><p>{event.instructions ?? t('authmodal.instructions.fallback')}</p><button type="button" className="button" onClick={() => onOpen(event.url)}><ExternalLink size={13} /> {t('authmodal.action.openSignIn')}</button></div> : null}
      {event.type === 'progress' ? <p className="modal-intro" role="status">{event.message}</p> : null}
      {event.type === 'prompt' ? <label className="field"><span>{event.message}</span><input autoFocus value={value} placeholder={event.placeholder} autoComplete="off" spellCheck={false} onChange={(change) => setValue(change.target.value)} onKeyDown={(key) => { if (key.key === 'Enter' && (event.allowEmpty || value.trim())) { key.preventDefault(); onRespond(event.promptId, value) } }} /></label> : null}
      {event.type === 'select' ? <div className="provider-auth-options" role="group" aria-labelledby={selectionLabelId}><p id={selectionLabelId}>{event.message}</p>{event.options.map((option) => <button type="button" key={option.id} onClick={() => onRespond(event.promptId, option.id)}>{option.label}</button>)}</div> : null}
      {event.type === 'complete' ? <p className="modal-intro" role="status">{t('authmodal.complete.message')}</p> : null}
      {event.type === 'error' ? <p className="page-inline-error" role="alert">{event.error}</p> : null}
    </Modal>
  )
}
