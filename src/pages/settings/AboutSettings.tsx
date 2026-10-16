import { CircleHelp } from 'lucide-react'
import { PtxMark } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { AppMeta } from '@/types/api'

interface AboutSettingsProps {
  meta?: AppMeta | null
  onOpenDocs(): void
}

export function AboutSettings({ meta, onOpenDocs }: AboutSettingsProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.about.title')}</h1><p>{t('settings.about.description')}</p></header>
      <section className="about-card"><PtxMark size={48} /><div><h2>Ptx</h2><p>{t('settings.about.tagline', { version: meta?.version ?? '0.1.0' })}</p></div></section>
      <section className="settings-group">
        <div className="settings-group__card">
        <div className="settings-row"><span><strong>{t('settings.about.platform')}</strong><small>{meta?.platform ?? 'macOS'}</small></span></div>
        <div className="settings-row"><span><strong>{t('settings.about.homeDirectory')}</strong><small className="mono">{meta?.homeDir ?? '—'}</small></span></div>
        <div className="settings-row"><span><strong>{t('settings.about.docs')}</strong></span><button className="button" type="button" onClick={onOpenDocs}><CircleHelp size={13} /> {t('settings.about.openDocs')}</button></div>
        </div>
      </section>
    </>
  )
}
