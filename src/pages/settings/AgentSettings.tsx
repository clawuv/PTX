import { Bot, Keyboard, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { SelectMenu } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { detectedHarnesses, HARNESS_AGENT_NAMES, HARNESS_PRODUCT_NAMES } from '@/lib/harness'
import { type MessageKey, useI18n } from '@/lib/i18n'
import { detectRendererPlatform, shortcutLabel } from '@/lib/platform-shortcuts'
import { HARNESS_IDS, type HarnessId, OMP_APPROVAL_MODES, type OmpApprovalMode } from '@/types/api'
import type { SettingsMetaSectionProps } from './contracts'
import { DraftSettingField } from './DraftSettingField'
import { SettingsToggle } from './SettingsToggle'

const APPROVAL_MODE_LABELS: Record<OmpApprovalMode, MessageKey> = {
  'inherit': 'settings.agent.approvalMode.inherit',
  'always-ask': 'settings.agent.approvalMode.alwaysAsk',
  'write': 'settings.agent.approvalMode.write',
  'yolo': 'settings.agent.approvalMode.yolo',
}

export function AgentSettings({ settings, meta, onUpdate, onRefreshHarnesses }: SettingsMetaSectionProps) {
  const { t } = useI18n()
  const activeHarness = settings.activeHarness
  const availableHarnesses = detectedHarnesses(meta)
  const approvalModeSupported = meta?.harnessCapabilities?.[activeHarness]?.approvalModeOverride ?? true
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const platform = meta?.platform ?? detectRendererPlatform()
  const oppositeActionShortcut = shortcutLabel(platform, ['Primary', 'Enter'])
  const newLineShortcut = shortcutLabel(platform, ['Shift', 'Enter'])
  const refreshHarnesses = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try { await onRefreshHarnesses() } catch (error) { setRefreshError(errorMessage(error)) }
    finally { setRefreshing(false) }
  }
  const runtimePathValidation = (value: string): MessageKey | '' => {
    if (!value) return ''
    const absolute = meta?.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') : value.startsWith('/')
    return absolute ? '' : 'settings.agent.pathOverride.error'
  }
  return (
    <>
      <header><h1>{t('settings.harness')}</h1><p>{t('settings.agent.description')}</p></header>
      <section className="settings-group">
        <h2>{t('settings.harness')}</h2>
        <label className="settings-row">
          <span><strong>{t('settings.agent.defaultHarness.label')}</strong><small>{t('settings.agent.defaultHarness.description')}</small></span>
          <SelectMenu
            label={t('settings.agent.defaultHarness.label')}
            disabled={!availableHarnesses.length}
            value={availableHarnesses.includes(activeHarness) ? activeHarness : ''}
            options={!availableHarnesses.length ? [{ value: '', label: t('settings.agent.defaultHarness.none') }] : availableHarnesses.map((harness) => ({ value: harness, label: HARNESS_PRODUCT_NAMES[harness] }))}
            onChange={(next) => { void onUpdate({ activeHarness: next as HarnessId }) }}
          />
        </label>
        {approvalModeSupported ? <label className="settings-row">
          <span><strong>{t('settings.agent.approvalMode.label')}</strong><small>{t('settings.agent.approvalMode.description')}</small></span>
          <SelectMenu
            label={t('settings.agent.approvalMode.label')}
            value={settings.ompApprovalMode}
            options={OMP_APPROVAL_MODES.map((mode) => ({ value: mode, label: t(APPROVAL_MODE_LABELS[mode]) }))}
            onChange={(next) => { void onUpdate({ ompApprovalMode: next as OmpApprovalMode }) }}
          />
        </label> : null}
      </section>
      <section className="settings-group">
        <div className="settings-group__heading">
          <h2>{t('settings.agent.runtime')}</h2>
          <button type="button" className="button button--compact" disabled={refreshing} onClick={() => { void refreshHarnesses() }}>
            <RefreshCw className={refreshing ? 'spin' : ''} size={13} />{refreshing ? t('settings.agent.refreshing') : t('settings.agent.refresh')}
          </button>
        </div>
        {refreshError ? <p className="settings-error" role="alert">{refreshError}</p> : null}
        {HARNESS_IDS.map((harness) => {
          const name = HARNESS_AGENT_NAMES[harness]
          const status = meta?.harnesses[harness]
          return (
            <div className="runtime-card" key={harness}>
              <span className={status?.path ? 'is-online' : ''}><Bot size={17} /></span>
              <div>
                <strong>{status?.path ? t('settings.agent.ready', { name }) : t('settings.agent.notDetected', { name })}</strong>
                <small title={status?.problem ? `${status.problem.path}: ${status.problem.reason}` : undefined}>{status?.path ?? (status?.problem ? `${status.problem.path}: ${status.problem.reason}` : t('settings.agent.installHint', { name }))}</small>
              </div>
              {status?.version ? <code>v{status.version}</code> : null}
            </div>
          )
        })}
        <p className="settings-group__description">{t('settings.agent.discoveryDescription')}</p>
        {HARNESS_IDS.map((harness) => <DraftSettingField
          key={harness}
          id={`runtime-path-${harness}`}
          label={t('settings.agent.pathOverride.label', { name: HARNESS_AGENT_NAMES[harness] })}
          description={t('settings.agent.pathOverride.description')}
          committedValue={settings.runtimePaths[harness]}
          validate={(value) => {
            const error = runtimePathValidation(value.trim())
            return error ? t(error, { name: HARNESS_AGENT_NAMES[harness] }) : ''
          }}
          normalize={(value) => value.trim()}
          onCommit={async (value) => {
            await onUpdate({ runtimePaths: { ...settings.runtimePaths, [harness]: value } })
            await refreshHarnesses()
          }}
        />)}
      </section>
      <section className="settings-group">
        <h2>{t('settings.agent.transcript')}</h2>
        <SettingsToggle checked={settings.showReasoningSummaries} onChange={(showReasoningSummaries) => { void onUpdate({ showReasoningSummaries }) }} label={t('settings.agent.reasoning.label')} description={t('settings.agent.reasoning.description')} />
        <SettingsToggle checked={settings.showToolCalls} onChange={(showToolCalls) => { void onUpdate({ showToolCalls }) }} label={t('settings.agent.toolCalls.label')} description={t('settings.agent.toolCalls.description')} />
      </section>
      <section className="settings-group">
        <h2>{t('settings.agent.shortcuts')}</h2>
        <label className="settings-row">
          <span><strong>{t('settings.agent.enterAction.label')}</strong><small>{t('settings.agent.enterAction.description', { opposite: oppositeActionShortcut, newline: newLineShortcut })}</small></span>
          <span className="shortcut-choice" role="radiogroup" aria-label={t('settings.agent.enterAction.aria')}>
            {(['queue', 'steer'] as const).map((action) => <button key={action} type="button" className={`button button--compact ${settings.messageEnterAction === action ? 'is-active' : ''}`} role="radio" aria-checked={settings.messageEnterAction === action} onClick={() => { void onUpdate({ messageEnterAction: action }) }}>{action === 'queue' ? t('settings.agent.enterAction.queue') : t('settings.agent.enterAction.steer')}</button>)}
          </span>
        </label>
        <div className="shortcut-row"><span><Keyboard size={14} />{settings.messageEnterAction === 'queue' ? t('settings.agent.shortcut.queueMessage') : t('settings.agent.shortcut.steerTurn')}</span><kbd>Enter</kbd></div>
        <div className="shortcut-row"><span><Keyboard size={14} />{settings.messageEnterAction === 'queue' ? t('settings.agent.shortcut.steerTurn') : t('settings.agent.shortcut.queueMessage')}</span><kbd>{oppositeActionShortcut}</kbd></div>
      </section>
      <section className="settings-group">
        <h2>{t('settings.agent.permissions')}</h2>
        <div className="info-row"><ShieldCheck size={15} /><div><strong>{t('settings.agent.workspaceAccess.title')}</strong><small>{t('settings.agent.workspaceAccess.description')}</small></div></div>
      </section>
    </>
  )
}
