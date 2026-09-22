import { useI18n } from '@/lib/i18n'
import { Modal } from './ui'

export function NoHarnessPrompt({ onClose, onOpenHarnessSettings }: { onClose(): void; onOpenHarnessSettings(): void }) {
  const { t } = useI18n()
  return (
    <Modal
      title={t('noprompt.title')}
      onClose={onClose}
      footer={<button type="button" className="button button--primary" onClick={onOpenHarnessSettings}>{t('noprompt.action')}</button>}
    >
      <p>{t('noprompt.body1')}</p>
      <p>{t('noprompt.body2')}</p>
    </Modal>
  )
}
