import { Check, KeyRound, Laptop, LoaderCircle, Mic2, RefreshCw, Server, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal, SelectMenu } from '@/components/ui'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { errorMessage } from '@/lib/errors'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import {
  DEEPGRAM_MODELS,
  GROQ_MODELS,
  OPENAI_FILE_MODELS,
  OPENAI_LIVE_MODELS,
  REALTIME_MODELS,
  REALTIME_VOICES,
  VOICE_PROVIDER_OPTIONS,
  optionsWithCurrent,
  type VoiceOption,
} from '@/lib/voice-options'
import type { AppSettings, PtxApi, VoiceCredentialProvider, VoiceCredentialStatus, VoiceTranscriptionProvider } from '@/types/api'
import type { SettingsSectionProps } from './contracts'

const CREDENTIALS: Array<{ id: VoiceCredentialProvider; nameKey: MessageKey; monogram: string; detailKey: MessageKey }> = [
  { id: 'openai', nameKey: 'settings.voice.credential.openai.name', monogram: 'OA', detailKey: 'settings.voice.credential.openai.detail' },
  { id: 'groq', nameKey: 'settings.voice.credential.groq.name', monogram: 'GQ', detailKey: 'settings.voice.credential.groq.detail' },
  { id: 'deepgram', nameKey: 'settings.voice.credential.deepgram.name', monogram: 'DG', detailKey: 'settings.voice.credential.deepgram.detail' },
  { id: 'self-hosted', nameKey: 'settings.voice.credential.selfHosted.name', monogram: 'SH', detailKey: 'settings.voice.credential.selfHosted.detail' },
]

const CONNECTION_CREDENTIALS = CREDENTIALS.filter((item) => item.id !== 'self-hosted')

interface VoiceSettingsProps extends SettingsSectionProps {
  voice: PtxApi['voice'] | null
  platform?: NodeJS.Platform
}

type VoiceServiceState = 'checking' | 'ready' | 'restart-required' | 'error'
type SelfHostedTestState = 'idle' | 'testing' | 'connected' | 'error'

function needsDesktopRestart(error: unknown): boolean {
  return /No handler registered for ['"]voice:/i.test(errorMessage(error))
}

function ModelSelect({ label, description, value, options, onChange }: { label: string; description: string; value: string; options: VoiceOption[]; onChange(value: string): void }) {
  const { t } = useI18n()
  const choices = optionsWithCurrent(options, value)
  const selected = choices.find((option) => option.value === value)
  return (
    <label className="voice-choice-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <span className="voice-choice-control">
        <SelectMenu
          label={label}
          value={value}
          options={choices.map((option) => ({ value: option.value, label: `${t(option.label, option.labelValues)}${option.recommended ? ` · ${t('settings.voice.option.recommended')}` : ''}` }))}
          onChange={onChange}
        />
        {selected ? <small>{t(selected.detail)}</small> : null}
      </span>
    </label>
  )
}

function PathInput({ label, description, placeholder, value, onCommit }: { label: string; description: string; placeholder: string; value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="voice-path-field">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input aria-label={label} value={draft} placeholder={placeholder} spellCheck={false} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onCommit(draft) }} />
    </label>
  )
}

export function VoiceSettings({ settings, onUpdate, voice, platform = 'darwin' }: VoiceSettingsProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<VoiceCredentialStatus | null>(null)
  const [serviceState, setServiceState] = useState<VoiceServiceState>(voice ? 'checking' : 'restart-required')
  const [credential, setCredential] = useState<VoiceCredentialProvider | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [selfHostedUrl, setSelfHostedUrl] = useState(settings.voiceSelfHostedUrl)
  const [selfHostedModel, setSelfHostedModel] = useState(settings.voiceSelfHostedModel)
  const [selfHostedTestState, setSelfHostedTestState] = useState<SelfHostedTestState>('idle')
  const [selfHostedMessage, setSelfHostedMessage] = useState('')

  useEffect(() => setSelfHostedUrl(settings.voiceSelfHostedUrl), [settings.voiceSelfHostedUrl])
  useEffect(() => setSelfHostedModel(settings.voiceSelfHostedModel), [settings.voiceSelfHostedModel])

  useEffect(() => {
    let active = true
    if (!voice) { setServiceState('restart-required'); return }
    setServiceState('checking')
    void voice.credentialStatus().then((next) => {
      if (active) { setStatus(next); setServiceState('ready') }
    }).catch((error) => {
      if (!active) return
      setStatus(null)
      if (needsDesktopRestart(error)) { setCredential(null); setFailure(''); setServiceState('restart-required') }
      else { setFailure(errorMessage(error)); setServiceState('error') }
    })
    return () => { active = false }
  }, [voice])

  const saveCredential = async () => {
    if (!voice || !credential || !apiKey.trim()) return
    setBusy(true); setFailure('')
    try {
      setStatus(await voice.saveApiKey(credential, apiKey))
      setApiKey(''); setCredential(null)
    } catch (error) { setFailure(errorMessage(error)) } finally { setBusy(false) }
  }

  const removeCredential = async (provider: VoiceCredentialProvider) => {
    if (!voice) return
    setBusy(true); setFailure('')
    try { setStatus(await voice.deleteApiKey(provider)) } catch (error) { setFailure(errorMessage(error)) } finally { setBusy(false) }
  }

  const closeCredential = () => { if (!busy) { setCredential(null); setApiKey(''); setFailure('') } }
  const openCredential = (provider: VoiceCredentialProvider) => { setFailure(''); setCredential(provider) }
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => { void onUpdate({ [key]: value } as Pick<AppSettings, K>) }
  const testSelfHosted = async () => {
    if (!voice || !selfHostedUrl.trim()) return
    setSelfHostedTestState('testing'); setSelfHostedMessage('')
    const url = selfHostedUrl.trim()
    const model = selfHostedModel.trim()
    try {
      await voice.testSelfHosted({ url, model })
      await onUpdate({ voiceSelfHostedUrl: url, voiceSelfHostedModel: model })
      setSelfHostedTestState('connected')
      setSelfHostedMessage(t('settings.voice.selfHosted.check.success'))
    } catch (error) {
      setSelfHostedTestState('error')
      setSelfHostedMessage(errorMessage(error))
    }
  }
  const provider = VOICE_PROVIDER_OPTIONS.find((option) => option.value === settings.voiceTranscriptionProvider) ?? VOICE_PROVIDER_OPTIONS[0]
  const selectedCredential = provider.credential
  const selectedConfigured = selectedCredential ? status?.configured[selectedCredential] ?? false : true
  const secureStorageAvailable = status?.storage.available ?? false
  const credentialName = (id: VoiceCredentialProvider) => {
    const item = CREDENTIALS.find((candidate) => candidate.id === id)
    return item ? t(item.nameKey) : id
  }

  return (
    <>
      <header className="voice-settings-header">
        <span className="voice-settings-header__icon"><Mic2 size={19} /></span>
        <div><h1>{t('settings.voice')}</h1><p>{t('settings.voice.description')}</p></div>
      </header>

      {serviceState === 'restart-required' ? (
        <div className="voice-bridge-notice" role="status">
          <RefreshCw size={17} />
          <span><strong>{t('settings.voice.restart.title')}</strong><small>{t('settings.voice.restart.description', { shortcut: shortcutLabel(platform, ['Primary', 'Q']) })}</small></span>
        </div>
      ) : null}

      <section className="settings-group" aria-labelledby="voice-connections-title">
        <h2 id="voice-connections-title">{t('settings.voice.connections')}</h2>
        <p className="settings-group__description">{t('settings.voice.connections.description')}</p>
        {serviceState === 'ready' && status && !secureStorageAvailable ? (
          <div className="voice-storage-notice" role="alert">
            <ShieldAlert size={17} />
            <span><strong>{t('settings.voice.storageNotice.title')}</strong><small>{t('settings.voice.storageNotice.description', { message: status.storage.message ?? '' })}</small></span>
          </div>
        ) : null}
        {voice ? <div className="voice-connection-grid">
          {CONNECTION_CREDENTIALS.map((item) => {
            const configured = status?.configured[item.id] ?? false
            const source = status?.source[item.id]
            return (
              <article className={`voice-connection-card${configured ? ' is-connected' : ''}`} key={item.id}>
                <span className="voice-provider-mark" aria-hidden="true">{item.monogram}</span>
                <div className="voice-connection-card__body">
                  <span className="voice-connection-card__title"><strong>{t(item.nameKey)}</strong><i>{serviceState === 'checking' ? t('settings.voice.status.checking') : serviceState === 'restart-required' ? t('settings.voice.status.restartRequired') : serviceState === 'error' ? t('settings.voice.status.unavailable') : configured ? source === 'environment' ? t('settings.voice.status.environmentKey') : source === 'session' ? t('settings.voice.status.sessionOnly') : t('settings.voice.status.connected') : source === 'saved' && !secureStorageAvailable ? t('settings.voice.status.storageLocked') : t('settings.voice.status.notConnected')}</i></span>
                  <small>{t(item.detailKey)}</small>
                </div>
                {serviceState === 'ready' ? <button type="button" className="button" disabled={busy} onClick={() => openCredential(item.id)}><KeyRound size={13} /> {configured ? t('settings.action.replaceKey') : t('settings.action.addKey')}</button> : null}
                {serviceState === 'ready' && (source === 'saved' || source === 'session') ? <button type="button" className="button button--icon" aria-label={t('settings.voice.action.removeKey', { name: t(item.nameKey) })} data-tooltip={t('settings.voice.action.removeKey', { name: t(item.nameKey) })} disabled={busy} onClick={() => void removeCredential(item.id)}><Trash2 size={13} /></button> : null}
              </article>
            )
          })}
        </div> : null}
        {failure && !credential ? <p className="settings-error" role="alert">{failure}</p> : null}
      </section>

      <section className="settings-group" aria-labelledby="voice-dictation-title">
        <h2 id="voice-dictation-title">{t('settings.voice.dictation')}</h2>
        <p className="settings-group__description">{t('settings.voice.dictation.description')}</p>
        <div className="voice-setup-card">
          <label className="voice-choice-row">
            <span><strong>{t('settings.voice.service.label')}</strong><small>{t('settings.voice.service.description')}</small></span>
            <span className="voice-choice-control">
              <SelectMenu
                label={t('settings.voice.service.aria')}
                value={settings.voiceTranscriptionProvider}
                options={VOICE_PROVIDER_OPTIONS.map((option) => ({ value: option.value, label: `${t(option.label)}${option.recommended ? ` · ${t('settings.voice.option.recommended')}` : ''}` }))}
                onChange={(next) => update('voiceTranscriptionProvider', next as VoiceTranscriptionProvider)}
              />
              <small>{t(provider.detail)}</small>
            </span>
          </label>

          {settings.voiceTranscriptionProvider === 'openai-live' ? <ModelSelect label={t('settings.voice.model.label')} description={t('settings.voice.model.live.description')} value={settings.voiceOpenAiLiveTranscriptionModel} options={OPENAI_LIVE_MODELS} onChange={(value) => update('voiceOpenAiLiveTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'openai' ? <ModelSelect label={t('settings.voice.model.label')} description={t('settings.voice.model.file.description')} value={settings.voiceOpenAiTranscriptionModel} options={OPENAI_FILE_MODELS} onChange={(value) => update('voiceOpenAiTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'groq' ? <ModelSelect label={t('settings.voice.model.label')} description={t('settings.voice.model.groq.description')} value={settings.voiceGroqTranscriptionModel} options={GROQ_MODELS} onChange={(value) => update('voiceGroqTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'deepgram' ? <ModelSelect label={t('settings.voice.model.label')} description={t('settings.voice.model.deepgram.description')} value={settings.voiceDeepgramTranscriptionModel} options={DEEPGRAM_MODELS} onChange={(value) => update('voiceDeepgramTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'self-hosted' ? (
            <div className="voice-self-hosted-setup">
              <span className="voice-local-setup__intro"><Server size={15} /><span><strong>{t('settings.voice.selfHosted.title')}</strong><small>{t('settings.voice.selfHosted.description')}</small></span></span>
              <label className="voice-path-field">
                <span><strong>{t('settings.voice.selfHosted.url.label')}</strong><small>{t('settings.voice.selfHosted.url.description')}</small></span>
                <input aria-label={t('settings.voice.selfHosted.url.aria')} type="url" value={selfHostedUrl} placeholder="http://127.0.0.1:9000" spellCheck={false} onChange={(event) => { setSelfHostedUrl(event.target.value); setSelfHostedTestState('idle'); setSelfHostedMessage('') }} onBlur={() => { const value = selfHostedUrl.trim(); if (value !== settings.voiceSelfHostedUrl) update('voiceSelfHostedUrl', value) }} />
              </label>
              <label className="voice-path-field">
                <span><strong>{t('settings.voice.selfHosted.model.label')}</strong><small>{t('settings.voice.selfHosted.model.description')}</small></span>
                <input aria-label={t('settings.voice.selfHosted.model.aria')} value={selfHostedModel} placeholder="nvidia/parakeet-tdt-0.6b-v3" spellCheck={false} onChange={(event) => { setSelfHostedModel(event.target.value); setSelfHostedTestState('idle'); setSelfHostedMessage('') }} onBlur={() => { const value = selfHostedModel.trim(); if (value !== settings.voiceSelfHostedModel) update('voiceSelfHostedModel', value) }} />
              </label>
              <div className="voice-self-hosted-auth">
                <span><strong>{t('settings.voice.selfHosted.token.label')}</strong><small>{t('settings.voice.selfHosted.token.description')}</small></span>
                <span className="voice-self-hosted-auth__actions">
                  <i>{status?.configured['self-hosted'] ? status.source['self-hosted'] === 'session' ? t('settings.voice.status.sessionOnly') : status.source['self-hosted'] === 'environment' ? t('settings.voice.status.environmentToken') : t('settings.voice.status.tokenSaved') : status?.source['self-hosted'] === 'saved' ? t('settings.voice.status.storageLocked') : t('settings.voice.status.noToken')}</i>
                  {voice && serviceState === 'ready' ? <button type="button" className="button" disabled={busy} onClick={() => openCredential('self-hosted')}><KeyRound size={13} /> {status?.configured['self-hosted'] ? t('settings.voice.action.replaceToken') : t('settings.voice.action.addToken')}</button> : null}
                  {voice && serviceState === 'ready' && (status?.source['self-hosted'] === 'saved' || status?.source['self-hosted'] === 'session') ? <button type="button" className="button button--icon" aria-label={t('settings.voice.action.removeToken')} data-tooltip={t('settings.voice.action.removeToken')} disabled={busy} onClick={() => void removeCredential('self-hosted')}><Trash2 size={13} /></button> : null}
                </span>
              </div>
              <div className="voice-self-hosted-connect">
                <span><strong>{t('settings.voice.selfHosted.check.title')}</strong><small>{t('settings.voice.selfHosted.check.description')}</small></span>
                <button type="button" className="button button--primary" disabled={!voice || !selfHostedUrl.trim() || selfHostedTestState === 'testing'} onClick={() => void testSelfHosted()}>{selfHostedTestState === 'testing' ? <LoaderCircle className="is-spinning" size={13} /> : <Server size={13} />} {selfHostedTestState === 'testing' ? t('settings.voice.selfHosted.check.testing') : t('settings.voice.selfHosted.check.action')}</button>
              </div>
              {selfHostedMessage ? <p className={`voice-self-hosted-result is-${selfHostedTestState}`} role={selfHostedTestState === 'error' ? 'alert' : 'status'}>{selfHostedTestState === 'connected' ? <Check size={13} /> : <ShieldAlert size={13} />}{selfHostedMessage}</p> : null}
              <p className="voice-self-hosted-note">{t('settings.voice.selfHosted.note')}</p>
            </div>
          ) : null}
          {settings.voiceTranscriptionProvider === 'local-whisper' ? (
            <div className="voice-local-setup">
              <span className="voice-local-setup__intro"><Laptop size={15} /><span><strong>{t('settings.voice.local.title')}</strong><small>{t('settings.voice.local.description')}</small></span></span>
              <PathInput label={t('settings.voice.local.executable.label')} description={t('settings.voice.local.executable.description')} placeholder="/opt/homebrew/bin/whisper-cli" value={settings.voiceLocalWhisperExecutable} onCommit={(value) => update('voiceLocalWhisperExecutable', value)} />
              <PathInput label={t('settings.voice.local.model.label')} description={t('settings.voice.local.model.description')} placeholder="/path/to/ggml-large-v3-turbo.bin" value={settings.voiceLocalWhisperModel} onCommit={(value) => update('voiceLocalWhisperModel', value)} />
            </div>
          ) : null}

          {settings.voiceTranscriptionProvider === 'self-hosted' ? (
            <div className={`voice-requirement${selfHostedUrl.trim() ? ' is-ready' : ''}`}>
              <span>{selfHostedUrl.trim() ? <Check size={13} /> : <Server size={13} />}{selfHostedUrl.trim() ? t('settings.voice.requirement.serverConfigured') : t('settings.voice.requirement.serverUrlRequired')}</span>
            </div>
          ) : selectedCredential ? (
            <div className={`voice-requirement${selectedConfigured ? ' is-ready' : ''}`}>
              <span>{selectedConfigured ? <Check size={13} /> : <KeyRound size={13} />}{selectedConfigured ? t('settings.voice.requirement.connected', { name: credentialName(selectedCredential) }) : t('settings.voice.requirement.keyRequired', { name: credentialName(selectedCredential) })}</span>
              {!selectedConfigured && voice && serviceState === 'ready' ? <button type="button" onClick={() => openCredential(selectedCredential)}>{t('settings.action.addKey')}</button> : null}
            </div>
          ) : <div className="voice-requirement is-ready"><span><Check size={13} />{t('settings.voice.requirement.localNoKey')}</span></div>}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="voice-realtime-title">
        <h2 id="voice-realtime-title">{t('settings.voice.realtime')}</h2>
        <p className="settings-group__description">{t('settings.voice.realtime.description')}</p>
        <div className="voice-setup-card">
          <ModelSelect label={t('settings.voice.realtime.model.label')} description={t('settings.voice.realtime.model.description')} value={settings.voiceRealtimeModel} options={REALTIME_MODELS} onChange={(value) => update('voiceRealtimeModel', value)} />
          <ModelSelect label={t('settings.voice.realtime.voice.label')} description={t('settings.voice.realtime.voice.description')} value={settings.voiceRealtimeVoice} options={REALTIME_VOICES} onChange={(value) => update('voiceRealtimeVoice', value)} />
          <div className={`voice-requirement${status?.configured.openai ? ' is-ready' : ''}`}>
            <span>{status?.configured.openai ? <Check size={13} /> : <KeyRound size={13} />}{status?.configured.openai ? t('settings.voice.realtime.openaiConnected') : t('settings.voice.realtime.openaiRequired')}</span>
            {!status?.configured.openai && voice && serviceState === 'ready' ? <button type="button" onClick={() => openCredential('openai')}>{t('settings.action.addKey')}</button> : null}
          </div>
          {secureStorageAvailable ? <p className="voice-realtime-note">{t('settings.voice.realtime.note')}</p> : null}
        </div>
      </section>

      {credential ? <Modal title={t('settings.voice.modal.title', { name: credentialName(credential) })} onClose={closeCredential} footer={<><button type="button" className="button" disabled={busy} onClick={closeCredential}>{t('settings.action.cancel')}</button><button type="button" className="button button--primary" disabled={busy || !apiKey.trim()} onClick={() => void saveCredential()}>{busy ? t('settings.action.saving') : credential === 'self-hosted' ? t('settings.voice.modal.saveToken') : t('settings.voice.modal.saveKey')}</button></>}>
        <p className="modal-intro">{secureStorageAvailable ? t('settings.voice.modal.intro.secure', { thing: credential === 'self-hosted' ? t('settings.voice.modal.thing.token') : t('settings.voice.modal.thing.key') }) : t('settings.voice.modal.intro.insecure', { thing: credential === 'self-hosted' ? t('settings.voice.modal.thing.tokenShort') : t('settings.voice.modal.thing.keyShort') })}</p>
        {failure ? <p className="settings-error" role="alert">{failure}</p> : null}
        <label className="field"><span>{credential === 'self-hosted' ? t('settings.voice.selfHosted.token.label') : t('settings.field.apiKey')}</span><input autoFocus type="password" value={apiKey} autoComplete="off" spellCheck={false} placeholder={credential === 'self-hosted' ? t('settings.voice.modal.placeholder.token') : t('settings.voice.modal.placeholder.key')} onChange={(event) => setApiKey(event.target.value)} /></label>
      </Modal> : null}
    </>
  )
}
