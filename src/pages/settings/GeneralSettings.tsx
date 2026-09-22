import { useI18n } from '@/lib/i18n'
import { SelectMenu } from '@/components/ui'
import type { AppSettings } from '@/types/api'
import type { SettingsSectionProps } from './contracts'
import { SettingsToggle } from './SettingsToggle'

export function GeneralSettings({ settings, onUpdate, platform }: SettingsSectionProps & { platform: NodeJS.Platform }) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.general')}</h1><p>{t('settings.general.description')}</p></header>
      <section className="settings-group">
        <h2>{t('settings.general.window')}</h2>
        <SettingsToggle checked={settings.sidebarOpen} onChange={(sidebarOpen) => { void onUpdate({ sidebarOpen }) }} label={t('settings.general.sidebar.label')} description={t('settings.general.sidebar.description')} />
        <SettingsToggle checked={settings.inspectorOpen} onChange={(inspectorOpen) => { void onUpdate({ inspectorOpen }) }} label={t('settings.general.inspector.label')} description={t('settings.general.inspector.description')} />
        <SettingsToggle checked={settings.showFileChangesPopup} onChange={(showFileChangesPopup) => { void onUpdate({ showFileChangesPopup }) }} label={t('settings.general.fileChanges.label')} description={t('settings.general.fileChanges.description')} />
      </section>
      {platform === 'darwin' ? (
        <section className="settings-group">
          <h2>{t('settings.general.startup')}</h2>
          <SettingsToggle checked={settings.keepRunningInBackground} onChange={(keepRunningInBackground) => { void onUpdate({ keepRunningInBackground }) }} label={t('settings.general.keepRunning.label')} description={t('settings.general.keepRunning.description')} />
          <SettingsToggle checked={settings.launchAtLogin} onChange={(launchAtLogin) => { void onUpdate({ launchAtLogin }) }} label={t('settings.general.launchAtLogin.label')} description={t('settings.general.launchAtLogin.description')} />
        </section>
      ) : null}
      <section className="settings-group">
        <h2>{t('settings.general.sessionDefaults')}</h2>
        <label className="settings-row">
          <span><strong>{t('settings.general.inspectorTab.label')}</strong><small>{t('settings.general.inspectorTab.description')}</small></span>
          <SelectMenu
            label={t('settings.general.inspectorTab.label')}
            value={settings.defaultInspectorTab}
            options={[
              { value: 'summary', label: t('settings.general.inspectorTab.summary') },
              { value: 'changes', label: t('settings.general.inspectorTab.changes') },
              { value: 'browser', label: t('settings.general.inspectorTab.browser') },
              { value: 'files', label: t('settings.general.inspectorTab.files') },
            ]}
            onChange={(next) => { void onUpdate({ defaultInspectorTab: next as AppSettings['defaultInspectorTab'] }) }}
          />
        </label>
      </section>
    </>
  )
}
