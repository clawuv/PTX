import { FeishuSettings } from './settings/FeishuSettings'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import { detectRendererPlatform } from '@/lib/platform-shortcuts'
import { Modal } from '@/components/ui'
import type { AppMeta, AppSettings, AgentModelCatalog, ProjectRecord, PtxApi } from '@/types/api'
import { AboutSettings } from './settings/AboutSettings'
import { AgentSettings } from './settings/AgentSettings'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { BrowserSettings } from './settings/BrowserSettings'
import type { SettingsSection, SettingsUpdate } from './settings/contracts'
import { GeneralSettings } from './settings/GeneralSettings'
import { PrivacySettings } from './settings/PrivacySettings'
import { PetsSettings } from './settings/PetsSettings'
import { ProvidersSettings } from './settings/ProviderSettings'
import { ProjectsPage } from './ProjectsPage'
import { SETTINGS_SECTION_GROUPS } from './settings/sections'
import { TerminalSettings } from './settings/TerminalSettings'
import { VoiceSettings } from './settings/VoiceSettings'

interface SettingsPageProps {
  settings: AppSettings
  meta?: AppMeta | null
  providerCatalog: AgentModelCatalog | null
  voice: PtxApi['voice'] | null
  pets: PtxApi['pets'] | null
  onUpdate: SettingsUpdate
  onClose(): void
  onResetBrowser(): Promise<void> | void
  onOpenDocs(): void
  onRefreshProviders(): Promise<void>
  onRefreshHarnesses(): Promise<void>
  onSetProviderEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllProvidersEnabled(): Promise<void>
  onSetAllProvidersDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  /** Project management renders inside Settings > Workspace. */
  projects: ProjectRecord[]
  onAddProject(): void
  onOpenProject(project: ProjectRecord): void
  onRemoveProject(project: ProjectRecord): void
  initialSection?: SettingsSection
  /** Re-applies initialSection for repeated navigation requests to the same section. */
  initialSectionRequestId?: number
  /** Sidebar-driven mode: the sidebar owns the section menu; the page renders only content. */
  section?: SettingsSection
  onSectionChange?(section: SettingsSection): void
}

export function SettingsPage({ settings, meta, providerCatalog, voice, pets, onClose, onUpdate, onResetBrowser, onOpenDocs, onRefreshProviders, onRefreshHarnesses, onSetProviderEnabled, onSetAllProvidersEnabled, onSetAllProvidersDisabled, onSetModelEnabled, projects, onAddProject, onOpenProject, onRemoveProject, initialSection = 'general', initialSectionRequestId = 0, section: controlledSection, onSectionChange }: SettingsPageProps) {
  const [internalSection, setInternalSection] = useState<SettingsSection>(initialSection)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const { t } = useI18n()
  const platform = meta?.platform ?? detectRendererPlatform()
  const section = controlledSection ?? internalSection

  useEffect(() => { setInternalSection(initialSection) }, [initialSection, initialSectionRequestId])

  const chooseSection = (next: SettingsSection) => {
    if (onSectionChange) onSectionChange(next)
    else setInternalSection(next)
  }

  const resetBrowser = async () => {
    setResetting(true)
    setResetError('')
    try {
      await onResetBrowser()
      setConfirmReset(false)
    } catch (error) {
      setResetError(errorMessage(error))
    } finally {
      setResetting(false)
    }
  }

  const content = (() => {
    switch (section) {
      case 'mobile': return <FeishuSettings />
      case 'general': return <GeneralSettings settings={settings} onUpdate={onUpdate} platform={platform} />
      case 'appearance': return <AppearanceSettings settings={settings} onUpdate={onUpdate} />
      case 'projects': return <ProjectsPage projects={projects} onAdd={onAddProject} onOpen={onOpenProject} onRemove={onRemoveProject} showHeaderAction={false} />
      case 'agent': return <AgentSettings settings={settings} meta={meta} onUpdate={onUpdate} onRefreshHarnesses={onRefreshHarnesses} />
      case 'providers': return <ProvidersSettings harness={settings.activeHarness} catalog={providerCatalog} onRefresh={onRefreshProviders} onSetEnabled={onSetProviderEnabled} onSetAllEnabled={onSetAllProvidersEnabled} onSetAllDisabled={onSetAllProvidersDisabled} onSetModelEnabled={onSetModelEnabled} onOpenDocs={onOpenDocs} />
      case 'voice': return <VoiceSettings settings={settings} onUpdate={onUpdate} voice={voice} platform={platform} />
      case 'pets': return <PetsSettings settings={settings} onUpdate={onUpdate} pets={pets} />
      case 'browser': return <BrowserSettings settings={settings} onUpdate={onUpdate} onRequestReset={() => { setResetError(''); setConfirmReset(true) }} />
      case 'terminal': return <TerminalSettings settings={settings} onUpdate={onUpdate} platform={platform} />
      case 'privacy': return <PrivacySettings settings={settings} onUpdate={onUpdate} />
      case 'about': return <AboutSettings meta={meta} onOpenDocs={onOpenDocs} />
    }
  })()

  return (
    <div className={`settings-page ${onSectionChange ? 'settings-page--embedded' : ''}`}>
      {onSectionChange ? null : (
        <nav className="settings-nav" aria-label={t('settings.sections')}>
          <button type="button" className="settings-nav__close" onClick={onClose}><ArrowLeft size={14} /><span>{t('settings.back')}</span></button>
          {SETTINGS_SECTION_GROUPS.map((group) => (
            <div key={String(group.label)} className="settings-nav__group" role="group" aria-label={t(group.label)}>
              <div className="settings-nav__group-label">{t(group.label)}</div>
              {group.sections.map(({ id, label, icon: Icon }) => (
                <button type="button" key={id} className={section === id ? 'is-active' : ''} onClick={() => chooseSection(id)}>
                  <Icon size={14} /><span>{t(label)}</span><ChevronRight size={12} />
                </button>
              ))}
            </div>
          ))}
        </nav>
      )}
      <div className="settings-content scroll-area"><div className="settings-content__inner">{content}</div></div>
      {confirmReset ? (
        <Modal
          title={t('settings.browser.reset.title')}
          onClose={() => { if (!resetting) setConfirmReset(false) }}
          footer={(
            <>
              <button type="button" className="button" disabled={resetting} onClick={() => setConfirmReset(false)}>{t('settings.action.cancel')}</button>
              <button type="button" className="button button--danger" disabled={resetting} onClick={() => { void resetBrowser() }}>{resetting ? t('settings.browser.reset.clearing') : t('settings.browser.reset.confirm')}</button>
            </>
          )}
        >
          <p>{t('settings.browser.reset.description')}</p>
          {resetError ? <p className="settings-error" role="alert">{resetError}</p> : null}
        </Modal>
      ) : null}
    </div>
  )
}
