import { Bot, LockKeyhole } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { SettingsSectionProps } from './contracts'

export function PrivacySettings(_props: SettingsSectionProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.privacy')}</h1><p>{t('settings.privacy.description')}</p></header>
      <section className="settings-group">
        <h2>{t('settings.privacy.localData')}</h2>
        <div className="settings-group__card">
          <div className="info-row"><LockKeyhole size={15} /><div><strong>{t('settings.privacy.localData.title')}</strong><small>{t('settings.privacy.localData.description')}</small></div></div>
        </div>
      </section>
      <section className="settings-group">
        <h2>{t('settings.privacy.requests')}</h2>
        <div className="settings-group__card">
          <div className="info-row"><Bot size={15} /><div><strong>{t('settings.privacy.requests.title')}</strong><small>{t('settings.privacy.requests.description')}</small></div></div>
        </div>
      </section>
    </>
  )
}
