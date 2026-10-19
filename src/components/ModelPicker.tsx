import { ArrowLeft, Brain, Check, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useI18n } from '@/lib/i18n'
import { REASONING_LABEL_KEYS as reasoningLabels } from '@/lib/reasoning'
import type { AgentModelDescriptor, AgentProviderDescriptor, AgentThinkingLevel } from '@/types/api'

interface ModelPickerProps {
  value: string
  modelsByProvider: ReadonlyMap<string, AgentModelDescriptor[]>
  providers: AgentProviderDescriptor[]
  onChange(value: string): void
  effort?: AgentThinkingLevel
  reasoningLevels?: AgentThinkingLevel[]
  onEffortChange?(value: AgentThinkingLevel): void
  onManageModels?(): void
}

interface ModelGroup {
  provider: AgentProviderDescriptor
  models: AgentModelDescriptor[]
}

export const ModelPicker = memo(function ModelPicker({ value, modelsByProvider, providers, onChange, onManageModels, effort, reasoningLevels, onEffortChange }: ModelPickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [effortModelKey, setEffortModelKey] = useState<string | null>(null)
  const effortRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const groups = useMemo<ModelGroup[]>(() => providers
    .filter((provider) => provider.enabled && (modelsByProvider.get(provider.id)?.length ?? 0) > 0)
    .map((provider) => ({ provider, models: modelsByProvider.get(provider.id) ?? [] })), [modelsByProvider, providers])
  const selected = useMemo(() => groups.flatMap((group) => group.models).find((model) => model.key === value), [groups, value])
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return groups.flatMap((group) => {
      const providerText = `${group.provider.name} ${group.provider.id}`.toLocaleLowerCase()
      const models = needle
        ? group.models.filter((model) => `${model.name} ${model.id} ${model.key} ${providerText}`.toLocaleLowerCase().includes(needle))
        : group.models
      return models.length ? [{ provider: group.provider, models }] : []
    })
  }, [groups, query])
  const visibleModels = useMemo(() => visibleGroups.flatMap((group) => group.models), [visibleGroups])
  const navigableModels = useMemo(() => visibleModels.filter((model) => model.available), [visibleModels])
  const modelCount = useMemo(() => groups.reduce((count, group) => count + group.models.length, 0), [groups])
  const effortModel = groups.flatMap((group) => group.models).find((model) => model.key === effortModelKey)
  const levels = effortModel?.key === value ? reasoningLevels ?? effortModel.availableThinkingLevels : effortModel?.availableThinkingLevels ?? []
  const showSearch = modelCount > 8
  // The open reset reads the catalog through a ref: a background catalog
  // refresh must not wipe a query the user is still typing.
  const catalogRef = useRef({ groups, selected })
  catalogRef.current = { groups, selected }

  const close = (restoreFocus = false) => {
    setOpen(false)
    setEffortModelKey(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const choose = (model: AgentModelDescriptor | undefined) => {
    if (!model?.available) return
    onChange(model.key)
    const supported = model.key === value ? reasoningLevels ?? model.availableThinkingLevels : model.availableThinkingLevels
    if (onEffortChange && supported.length > 1) setEffortModelKey(model.key)
    else close(true)
  }
  useEffect(() => {
    if (effortModelKey) effortRef.current?.focus()
  }, [effortModelKey])
  const moveActive = (direction: 1 | -1) => {
    if (!navigableModels.length) return
    const current = navigableModels.findIndex((model) => model.key === activeKey)
    const next = current < 0
      ? direction > 0 ? 0 : navigableModels.length - 1
      : (current + direction + navigableModels.length) % navigableModels.length
    setActiveKey(navigableModels[next].key)
  }

  useEffect(() => {
    if (!open) return
    const { groups: openGroups, selected: openSelected } = catalogRef.current
    setQuery('')
    setActiveKey(openSelected?.available
      ? openSelected.key
      : openGroups.flatMap((group) => group.models).find((model) => model.available)?.key ?? null)
    requestAnimationFrame(() => (showSearch ? searchRef.current : popoverRef.current)?.focus())
  }, [open, showSearch])

  useEffect(() => {
    if (!open) return
    if (!navigableModels.some((model) => model.key === activeKey)) setActiveKey(navigableModels[0]?.key ?? null)
  }, [activeKey, navigableModels, open])

  useEffect(() => {
    if (!open || !activeKey) return
    document.getElementById(`${listId}-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeKey, listId, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (effortModel) {
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const buttons = [...(popoverRef.current?.querySelectorAll<HTMLButtonElement>('.model-picker__level') ?? [])]
        const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1
        const direction = event.key === 'ArrowDown' ? 1 : -1
        buttons[(current + direction + buttons.length) % buttons.length]?.focus()
      }
      return
    }
    if (event.target instanceof HTMLElement && event.target.closest('.model-picker__manage')) return
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActiveKey(navigableModels[0]?.key ?? null) }
    else if (event.key === 'End') { event.preventDefault(); setActiveKey(navigableModels.at(-1)?.key ?? null) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(navigableModels.find((model) => model.key === activeKey)) }
    else if (event.key === 'Escape') { event.preventDefault(); close(true) }
  }

  const resultCount = visibleModels.length
  return (
    <div className="model-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="permissions-chip model-picker__trigger"
        aria-label={t('modelpicker.triggerAria', { name: selected?.name ?? t('modelpicker.noModel') })}
        title={selected?.name ?? t('modelpicker.noModel')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${listId}-dialog` : undefined}
        disabled={!groups.length}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Brain size={13} />
        <span>{selected?.name ?? t('modelpicker.noModel')}</span>
        {onEffortChange && effort && (reasoningLevels?.length ?? 0) > 1 ? (
          <span className="model-picker__trigger-effort">{t(reasoningLabels[effort])}</span>
        ) : null}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="model-picker__popover"
          role="dialog"
          aria-label={t(effortModel ? 'composer.reasoning.label' : 'modelpicker.listAria')}
          id={`${listId}-dialog`}
          ref={popoverRef}
          tabIndex={-1}
          onKeyDown={onPopoverKeyDown}
          onBlur={(event) => {
            // Tabbing past the filters must dismiss like the native select did.
            // A null relatedTarget means focus left the document entirely (app
            // switch), which keeps the popover and the typed query alive.
            const next = event.relatedTarget
            if (next instanceof Node && !rootRef.current?.contains(next)) close()
          }}
        >
          {effortModel ? (
            <>
              <button type="button" className="model-picker__back" onClick={() => { setEffortModelKey(null); requestAnimationFrame(() => popoverRef.current?.focus()) }}>
                <ArrowLeft size={14} /><span>{effortModel.name}</span>
              </button>
              <div className="model-picker__effort-heading">{t('composer.reasoning.label')}</div>
              <div className="model-picker__levels" role="group" aria-label={t('composer.reasoning.label')}>
                {levels.map((level, index) => (
                  <button key={level} ref={index === 0 ? effortRef : undefined} type="button" className="model-picker__level" aria-pressed={effort === level}
                    onClick={() => { onEffortChange?.(level); close(true) }}>
                    <span>{t(reasoningLabels[level])}</span>{effort === level ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : <>
          {showSearch ? (
            <div className="model-picker__search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                role="combobox"
                aria-label={t('modelpicker.search')}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
                placeholder={t('modelpicker.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
          <div className="model-picker__results" id={listId} role="listbox" aria-label={t('modelpicker.listAria')}>
            {visibleGroups.map(({ provider, models }) => (
              <div className="model-picker__group" role="group" aria-label={provider.name} key={provider.id}>
                {visibleGroups.length > 1 ? <div className="model-picker__group-heading">{provider.name}</div> : null}
                {models.map((candidate) => {
                  const isSelected = candidate.key === value
                  const isActive = candidate.key === activeKey
                  return (
                    <button
                      type="button"
                      tabIndex={-1}
                      role="option"
                      id={`${listId}-${candidate.key}`}
                      key={candidate.key}
                      aria-selected={isSelected}
                      aria-disabled={!candidate.available}
                      className={`model-picker__option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                      onMouseMove={() => { if (candidate.available) setActiveKey(candidate.key) }}
                      onClick={() => choose(candidate)}
                    >
                      <span className="model-picker__identity"><strong>{candidate.name}</strong></span>
                      {!candidate.available ? <span className="model-picker__availability">{t('modelpicker.connect')}</span> : null}
                      <span className="model-picker__check">{isSelected ? <Check size={13} /> : onEffortChange && candidate.availableThinkingLevels.length > 1 ? <ChevronRight size={13} /> : null}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            {!resultCount ? <div className="model-picker__empty">{query.trim() ? t('modelpicker.noSearchMatch') : t('modelpicker.noProviderModels')}</div> : null}
          </div>
          </>}
          {!effortModel && onManageModels ? <button type="button" className="model-picker__manage" onClick={() => { close(); onManageModels() }}>{t('modelpicker.manage')}</button> : null}
        </div>
      ) : null}
    </div>
  )
})
