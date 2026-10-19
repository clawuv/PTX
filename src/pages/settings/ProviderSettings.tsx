import { ChevronRight, ExternalLink, Gauge, RefreshCw, Search, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Modal, SelectMenu } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { HARNESS_AGENT_NAMES } from '@/lib/harness'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { REASONING_LABEL_KEYS } from '@/lib/reasoning'
import type { AgentModelCatalog, AgentModelDescriptor, AgentProviderDescriptor, AgentThinkingLevel, HarnessId } from '@/types/api'

interface ProviderSettingsProps {
  /** Active harness. OMP and Pi credentials stay CLI-owned; visibility toggles only affect Ptx. */
  harness?: HarnessId
  catalog: AgentModelCatalog | null
  onRefresh(): Promise<void>
  onSetEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllEnabled(): Promise<void>
  onSetAllDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  /** Stores a model's default reasoning effort; an empty level clears it. */
  onSetModelEffort(modelKey: string, level: AgentThinkingLevel | ''): Promise<void>
  onOpenDocs(): void
}

type ProviderFilter = 'all' | 'shown' | 'hidden'

const FILTER_LABELS: Record<ProviderFilter, MessageKey> = {
  all: 'providers.filter.all',
  shown: 'providers.filter.shown',
  hidden: 'providers.filter.hidden',
}

/** Enabled first, then alphabetical: the picker's own order. */
function activeFirst<T extends { enabled?: boolean; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (
    Number(right.enabled !== false) - Number(left.enabled !== false) || left.name.localeCompare(right.name, 'en-US')
  ))
}

/** Compact token counts for the capability line (`400000` → `400k`). */
function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '—'
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(count % 1_000_000 ? 1 : 0))}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => field?.toLowerCase().includes(needle))
}

/**
 * Provider/model browser: the left pane lists providers (search, filter, on/off
 * switch), the right pane shows the selected provider's models with the
 * capability detail, the per-model visibility switch, and the per-model default
 * reasoning effort. Each pane owns its own query so switching providers never
 * discards what the other pane was searching for.
 */
export function ProviderSettings({ harness = 'omp', catalog, onRefresh, onSetEnabled, onSetAllEnabled, onSetAllDisabled, onSetModelEnabled, onSetModelEffort, onOpenDocs }: ProviderSettingsProps) {
  const { t } = useI18n()
  // OMP and Pi own their credentials in their CLIs; Ptx only toggles visibility.
  const externalAuth = true
  const agentName = HARNESS_AGENT_NAMES[harness]
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [filter, setFilter] = useState<ProviderFilter>('all')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmHideAll, setConfirmHideAll] = useState(false)

  const allProviders = useMemo(() => activeFirst(catalog?.providers ?? []), [catalog])
  const filterCounts = useMemo(() => ({
    all: allProviders.length,
    shown: allProviders.filter((provider) => provider.enabled).length,
    hidden: allProviders.filter((provider) => !provider.enabled).length,
  }), [allProviders])
  const visibleProviders = useMemo(() => allProviders.filter((provider) => (
    (filter === 'all' || (filter === 'shown' ? provider.enabled : !provider.enabled))
    && matches(providerQuery, provider.name, provider.id)
  )), [allProviders, filter, providerQuery])

  // The selection follows the catalogue: a hidden provider stays selectable
  // while the filter shows it, but a stale id falls back to the first row.
  const selectedProvider = allProviders.find((provider) => provider.id === selectedProviderId) ?? visibleProviders[0] ?? allProviders[0]
  const providerModels = useMemo(() => activeFirst(
    (catalog?.models ?? []).filter((model) => model.provider === selectedProvider?.id && matches(modelQuery, model.name, model.id, model.key)),
  ), [catalog, modelQuery, selectedProvider?.id])
  const providerModelTotal = (catalog?.models ?? []).filter((model) => model.provider === selectedProvider?.id).length
  // One pass for every provider's "on" count; the list must not rescan the
  // whole catalogue per row on each keystroke.
  const onCountByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of catalog?.models ?? []) {
      if (model.enabled !== false) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
    }
    return counts
  }, [catalog])

  const providerCount = catalog?.providers.length ?? 0
  const modelCount = catalog?.models.length ?? 0
  const availableModelCount = catalog?.models.filter((model) => model.available && model.enabled !== false).length ?? 0
  const disabledCount = catalog?.providers.filter((provider) => !provider.enabled).length ?? 0

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id)
    setError('')
    try { await action() } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(null) }
  }
  const toggleProvider = (provider: AgentProviderDescriptor) => void run(
    provider.id,
    () => onSetEnabled(provider.id, !provider.enabled),
  )
  // Provider-level bulk model control rides the provider switch: enabling a
  // provider clears every sibling model's hidden flag, disabling hides them all.
  const toggleModels = (provider: AgentProviderDescriptor) => void run(
    `models:${provider.id}`,
    () => onSetEnabled(provider.id, !provider.enabled),
  )

  return (
    <section className="settings-group provider-settings">
      <div className="settings-group__heading">
        <h2>{t('providers.catalogue', { name: agentName })}</h2>
        <div className="provider-heading-actions">
          {catalog && disabledCount < providerCount
            ? <button type="button" className="button button--danger" disabled={Boolean(busy)} onClick={() => setConfirmHideAll(true)}>{externalAuth ? t('providers.action.hideAll') : t('providers.action.disableAll')}</button>
            : null}
          {disabledCount
            ? <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void run('enable-all', onSetAllEnabled)}>{externalAuth ? t('providers.action.showAll') : t('providers.action.enableAll')}</button>
            : null}
          <button type="button" className="button button--icon" aria-label={t('providers.action.refresh')} data-tooltip={t('providers.action.refresh')} disabled={Boolean(busy)} onClick={() => void run('refresh', onRefresh)}><RefreshCw size={13} /></button>
        </div>
      </div>
      <div className="settings-group__card">
        <div className="provider-catalog-summary">
          <strong>{catalog ? t('providers.summary.counts', { providers: providerCount.toLocaleString(), models: modelCount.toLocaleString() }) : t('providers.summary.loading')}</strong>
          {catalog ? <small>{t('providers.summary.external', { count: availableModelCount.toLocaleString(), name: agentName })}</small> : null}
        </div>
        {catalog?.warning ? <p className="provider-catalog-warning" role="status">{catalog.warning}</p> : null}
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        <div className="provider-browser">
          <div className="provider-browser__pane">
            <label className="provider-search">
              <Search size={13} />
              <input value={providerQuery} placeholder={t('providers.search.providers')} aria-label={t('providers.search.providers')} onChange={(event) => setProviderQuery(event.target.value)} />
            </label>
            <div className="provider-filter" role="group" aria-label={t('providers.filter.aria')}>
              {(Object.keys(FILTER_LABELS) as ProviderFilter[]).map((option) => (
                <button key={option} type="button" className={filter === option ? 'is-active' : ''} aria-pressed={filter === option} onClick={() => setFilter(option)}>
                  {t(FILTER_LABELS[option])} <span>{filterCounts[option].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className="provider-list" role="group" aria-label={t('providers.browser.providersAria')}>
              {visibleProviders.map((provider) => {
                const isSelected = provider.id === selectedProvider?.id
                const onCount = onCountByProvider.get(provider.id) ?? 0
                return (
                  <div className={`provider-row${isSelected ? ' is-selected' : ''}`} key={provider.id}>
                    <button type="button" className="provider-row__select" aria-pressed={isSelected} onClick={() => setSelectedProviderId(provider.id)}>
                      <i className={`provider-row__dot${provider.enabled ? ' is-on' : ''}`} aria-hidden="true" />
                      <span className="provider-row__identity">
                        <strong>{provider.name}</strong>
                        <small>{t('providers.row.modelsOn', { on: onCount.toLocaleString(), total: provider.modelCount.toLocaleString() })}</small>
                      </span>
                      <ChevronRight className="provider-row__chevron" size={12} aria-hidden="true" />
                    </button>
                    <label className="provider-row__toggle" data-tooltip={provider.enabled ? t('providers.row.hideTitle', { name: agentName }) : t('providers.row.showTitle', { name: agentName })}>
                      <input type="checkbox" aria-label={t('providers.row.showAria', { name: provider.name })} checked={provider.enabled} disabled={busy === provider.id} onChange={() => toggleProvider(provider)} />
                      <i aria-hidden="true"><span /></i>
                    </label>
                  </div>
                )
              })}
              {catalog && !visibleProviders.length ? <p className="settings-empty">{t('providers.empty.providers')}</p> : null}
            </div>
          </div>
          <div className="provider-browser__pane provider-browser__detail">
            {selectedProvider ? (
              <>
                <div className="provider-detail__head">
                  <div className="provider-row__identity">
                    <strong>{selectedProvider.name}</strong>
                    <small>{`${selectedProvider.authLabel ?? t('providers.row.managedByCli', { harness })} · ${t('providers.detail.modelsOn', { on: providerModels.filter((model) => model.enabled !== false).length.toLocaleString(), total: providerModelTotal.toLocaleString() })}`}</small>
                  </div>
                  <div className="provider-row__actions">
                    <button type="button" className="button" onClick={onOpenDocs}><ExternalLink size={12} /> {t('providers.action.docs')}</button>
                    <label className="provider-row__toggle" data-tooltip={selectedProvider.enabled ? t('providers.detail.hideAllTitle', { name: selectedProvider.name }) : t('providers.detail.showAllTitle', { name: selectedProvider.name })}>
                      <input type="checkbox" aria-label={t('providers.detail.toggleAria', { name: selectedProvider.name })} checked={selectedProvider.enabled} disabled={busy === `models:${selectedProvider.id}`} onChange={() => toggleModels(selectedProvider)} />
                      <i aria-hidden="true"><span /></i>
                    </label>
                  </div>
                </div>
                <label className="provider-search">
                  <Search size={13} />
                  <input value={modelQuery} placeholder={t('providers.search.models')} aria-label={t('providers.search.modelsOf', { name: selectedProvider.name })} onChange={(event) => setModelQuery(event.target.value)} />
                </label>
                <div className="provider-list provider-model-list" role="group" aria-label={t('providers.browser.modelsAria', { name: selectedProvider.name })}>
                  {providerModels.map((model) => (
                    <ModelRow
                      key={model.key}
                      model={model}
                      agentName={agentName}
                      externalAuth={externalAuth}
                      busy={busy}
                      onSetEnabled={onSetModelEnabled}
                      onSetEffort={onSetModelEffort}
                      run={run}
                    />
                  ))}
                  {!providerModels.length ? <p className="settings-empty">{modelQuery.trim() ? t('providers.empty.models') : t('providers.empty.providerModels')}</p> : null}
                </div>
              </>
            ) : <p className="settings-empty">{catalog ? t('providers.empty.providers') : t('providers.summary.loading')}</p>}
          </div>
        </div>
      </div>
      {confirmHideAll ? (
        <Modal
          title={t('providers.action.hideAllConfirmTitle', { name: agentName })}
          onClose={() => setConfirmHideAll(false)}
          footer={<>
            <button type="button" className="button" onClick={() => setConfirmHideAll(false)}>{t('providers.action.cancel')}</button>
            <button type="button" className="button button--danger" disabled={Boolean(busy)} onClick={() => { setConfirmHideAll(false); void run('disable-all', onSetAllDisabled) }}>{externalAuth ? t('providers.action.hideAll') : t('providers.action.disableAll')}</button>
          </>}
        >
          <p>{t('providers.action.hideAllConfirmBody', { count: providerCount.toLocaleString(), name: agentName })}</p>
        </Modal>
      ) : null}
    </section>
  )
}

interface ModelRowProps {
  model: AgentModelDescriptor
  agentName: string
  externalAuth: boolean
  busy: string | null
  onSetEnabled(modelKey: string, enabled: boolean): Promise<void>
  onSetEffort(modelKey: string, level: AgentThinkingLevel | ''): Promise<void>
  run(id: string, action: () => Promise<void>): Promise<void>
}

/** One model: identity, real capabilities, the default reasoning effort, and the visibility switch. */
function ModelRow({ model, agentName, externalAuth, busy, onSetEnabled, onSetEffort, run }: ModelRowProps) {
  const { t } = useI18n()
  const levels = model.availableThinkingLevels
  const effortOptions = useMemo(() => [
    { value: '', label: t('providers.effort.inherit') },
    ...levels.map((level) => ({ value: level, label: t(REASONING_LABEL_KEYS[level]) })),
  ], [levels, t])
  return (
    <div className={`provider-model-row${model.enabled === false ? ' is-disabled' : ''}`}>
      <div className="provider-row__identity">
        <strong>{model.name}</strong>
        <small>{model.id}</small>
      </div>
      <div className="provider-model-row__capabilities">
        <span>{t('providers.models.context', { count: formatTokens(model.contextWindow) })}</span>
        <span>{t('providers.models.output', { count: formatTokens(model.maxTokens) })}</span>
        {model.input.includes('image') ? <span>{t('providers.models.image')}</span> : null}
        {model.reasoning ? <span data-tooltip={t('providers.models.reasoningLevels', { count: levels.length })}><Gauge size={11} /> {t('providers.models.reasoning')}</span> : null}
        {model.fastModeSupported ? <span><Zap size={11} /> {t('providers.models.fast')}</span> : null}
        <span className={model.available && model.enabled !== false ? 'is-available' : ''}>{model.enabled === false ? (externalAuth ? t('providers.models.hidden') : t('providers.models.disabled')) : externalAuth ? t('providers.models.shown') : model.available ? t('providers.models.available') : t('providers.models.needsCredentials')}</span>
      </div>
      {levels.length > 1 ? (
        <SelectMenu
          className="provider-model-row__effort"
          label={t('providers.effort.title', { name: model.name })}
          value={model.defaultThinkingLevel ?? ''}
          options={effortOptions}
          disabled={busy === `effort:${model.key}`}
          onChange={(level) => void run(`effort:${model.key}`, () => onSetEffort(model.key, level as AgentThinkingLevel | ''))}
        />
      ) : null}
      <label className="provider-row__toggle provider-model-row__toggle" data-tooltip={model.enabled === false ? t('providers.models.showTitle', { name: agentName }) : t('providers.models.hideTitle', { name: agentName })}>
        <input type="checkbox" aria-label={t('providers.models.showAria', { name: model.name })} checked={model.enabled !== false} disabled={busy === `model:${model.key}`} onChange={(event) => { const next = event.target.checked; void run(`model:${model.key}`, () => onSetEnabled(model.key, next)) }} />
        <i aria-hidden="true"><span /></i>
      </label>
    </div>
  )
}

const PROVIDERS_PAGE_INTROS: Record<HarnessId, MessageKey> = {
  omp: 'providers.intro.omp',
  pi: 'providers.intro.pi',
}

/** The Providers settings page: heading plus the provider/model catalog section. */
export function ProvidersSettings(props: ProviderSettingsProps) {
  const { t } = useI18n()
  return (
    <>
      <header><h1>{t('settings.providers')}</h1><p>{t(PROVIDERS_PAGE_INTROS[props.harness ?? 'omp'])}</p></header>
      <ProviderSettings {...props} />
    </>
  )
}
