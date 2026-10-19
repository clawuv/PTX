// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderCatalog } from '../../src/hooks/useProviderCatalog'
import { ProviderSettings } from '../../src/pages/settings/ProviderSettings'
import type { HarnessId, AgentModelCatalog, PtxApi, RuntimeInfo } from '../../src/types/api'

vi.mock('../../src/components/ui', () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => <div role="dialog" aria-label={title}>{children}{footer}</div>,
  SelectMenu: ({ label, value, options, onChange, disabled }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void; disabled?: boolean }) => (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

const model = {
  key: 'openai-codex/gpt-5.6', provider: 'openai-codex', id: 'gpt-5.6', name: 'GPT-5.6', reasoning: true,
  input: ['text'] as const, contextWindow: 400_000, maxTokens: 128_000,
  availableThinkingLevels: ['low', 'medium', 'high'] as const, fastModeSupported: true, available: true,
}
const catalog: AgentModelCatalog = {
  harnessVersion: '0.7.0',
  refreshedAt: '2026-08-06T00:00:00.000Z',
  models: [
    { ...model, key: 'anthropic/claude-sonnet', provider: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet', input: [...model.input], availableThinkingLevels: ['low', 'high'], enabled: false },
    { ...model, key: 'openai-codex/gpt-5.5', id: 'gpt-5.5', name: 'GPT-5.5', input: [...model.input], availableThinkingLevels: ['low', 'high'], enabled: false },
    { ...model, input: [...model.input], availableThinkingLevels: [...model.availableThinkingLevels], enabled: true },
  ],
  providers: [
    { id: 'anthropic', name: 'Anthropic', authMethod: 'api_key', configured: false, modelCount: 14, availableModelCount: 0, enabled: false },
    { id: 'openai-codex', name: 'ChatGPT Plus/Pro', authMethod: 'oauth', configured: true, authSource: 'stored', modelCount: 8, availableModelCount: 8, enabled: true },
  ],
}
const runtime: RuntimeInfo = {
  runtimeId: 'runtime-1', harness: 'omp', cwd: '/tmp/project', isStreaming: false,
  model: { provider: model.provider, id: model.id, name: model.name },
  thinkingLevel: 'medium', serviceTier: 'default',
}
const noop = async () => undefined
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(node: ReactNode) {
  await act(async () => { root.render(node) })
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label) || item.getAttribute('aria-label') === label)
  if (!match) throw new Error(`Button not found: ${label}`)
  return match as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

/** React tracks the DOM value, so typing requires the native setter. */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

describe('provider settings behavior and accessibility', () => {
  const allProps = { onRefresh: noop, onSetEnabled: noop, onSetAllEnabled: noop, onSetAllDisabled: noop, onSetModelEnabled: noop, onSetModelEffort: noop, onOpenDocs: () => undefined }

  it('gives each enable checkbox a provider-specific accessible name and reports toggle failure', async () => {
    const onSetEnabled = vi.fn().mockRejectedValue(new Error('Provider policy was not saved'))
    await render(<ProviderSettings catalog={catalog} {...allProps} onSetEnabled={onSetEnabled} />)

    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Show Anthropic provider"]')
    expect(checkbox).not.toBeNull()
    await click(checkbox!)

    expect(onSetEnabled).toHaveBeenCalledWith('anthropic', true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Provider policy was not saved')
  })

  it('browses providers on the left and the selected provider models on the right', async () => {
    const onSetAllEnabled = vi.fn().mockResolvedValue(undefined)
    await render(<ProviderSettings catalog={catalog} {...allProps} onSetAllEnabled={onSetAllEnabled} />)

    expect(container.textContent).toContain('2 providers · 3 models')
    // Enabled providers sort first, and the first one is selected on open.
    const providerRows = [...container.querySelectorAll('.provider-row')]
    expect(providerRows[0]?.textContent).toContain('ChatGPT Plus/Pro')
    expect(providerRows[1]?.textContent).toContain('Anthropic')
    expect(providerRows[0]?.classList.contains('is-selected')).toBe(true)
    expect(container.querySelector('.provider-browser__detail')?.textContent).toContain('GPT-5.6')
    expect(container.querySelector('.provider-browser__detail')?.textContent).not.toContain('Claude Sonnet')
    expect(button('Provider docs')).toBeTruthy()

    // Selecting another provider swaps the detail pane without losing either query.
    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search providers"]')!
    await type(searchInput, 'anth')
    const filtered = [...container.querySelectorAll('.provider-row')]
    expect(filtered).toHaveLength(1)
    await click(filtered[0]!.querySelector<HTMLElement>('.provider-row__select')!)
    expect(container.querySelector('.provider-browser__detail')?.textContent).toContain('Claude Sonnet')

    await type(searchInput, '')
    await click(button('Shown 1'))
    expect(container.querySelectorAll('.provider-row')).toHaveLength(1)
    expect(container.querySelector('.provider-row')?.textContent).toContain('ChatGPT Plus/Pro')
    await click(button('Hidden 1'))
    expect(container.querySelector('.provider-row')?.textContent).toContain('Anthropic')
    await click(button('All 2'))
    expect(container.querySelectorAll('.provider-row')).toHaveLength(2)

    await click(button('Show all'))
    expect(onSetAllEnabled).toHaveBeenCalledTimes(1)
  })

  it('confirms the hide-all bulk mutation instead of applying it on the first click', async () => {
    const onSetAllDisabled = vi.fn().mockResolvedValue(undefined)
    await render(<ProviderSettings catalog={catalog} {...allProps} onSetAllDisabled={onSetAllDisabled} />)

    await click(button('Hide all'))
    expect(onSetAllDisabled).not.toHaveBeenCalled()
    // The dialog title is its accessible name; the body explains the blast radius.
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Hide every OMP provider?')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('All 2 providers disappear')

    const confirm = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].filter((item) => item.textContent === 'Hide all').at(-1)!
    await click(confirm)
    expect(onSetAllDisabled).toHaveBeenCalledTimes(1)
  })

  it('shows real model capabilities and keeps the visibility switch right-most', async () => {
    const onSetModelEnabled = vi.fn().mockResolvedValue(undefined)
    await render(<ProviderSettings catalog={catalog} {...allProps} onSetModelEnabled={onSetModelEnabled} />)

    const row = container.querySelector('.provider-model-row')!
    expect(row.textContent).toContain('400k ctx')
    expect(row.textContent).toContain('128k out')
    expect(row.textContent).toContain('Reasoning')
    expect(row.textContent).toContain('Fast')
    expect(row.lastElementChild?.classList.contains('provider-model-row__toggle')).toBe(true)

    const toggle = row.querySelector<HTMLInputElement>('input[aria-label="Show GPT-5.6 model"]')!
    await click(toggle)
    expect(onSetModelEnabled).toHaveBeenCalledWith('openai-codex/gpt-5.6', false)
  })

  it('stores a per-model default reasoning level and can clear it', async () => {
    const onSetModelEffort = vi.fn().mockResolvedValue(undefined)
    await render(<ProviderSettings catalog={catalog} {...allProps} onSetModelEffort={onSetModelEffort} />)

    const effort = container.querySelector<HTMLSelectElement>('select[aria-label="Default reasoning level for GPT-5.6"]')
    expect(effort).not.toBeNull()
    // Unset means "follow the session's level"; the shipped fixture has no default.
    expect(effort!.value).toBe('')
    expect([...effort!.options].map((option) => option.textContent)).toEqual(['Follow session', 'Low', 'Standard', 'High'])

    await act(async () => {
      effort!.value = 'high'
      effort!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSetModelEffort).toHaveBeenCalledWith('openai-codex/gpt-5.6', 'high')

    const cleared = container.querySelector<HTMLSelectElement>('select[aria-label="Default reasoning level for GPT-5.6"]')!
    await act(async () => {
      cleared.value = ''
      cleared.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSetModelEffort).toHaveBeenLastCalledWith('openai-codex/gpt-5.6', '')
  })

  it('hides the reasoning control for models with a single level', async () => {
    const flat: AgentModelCatalog = {
      ...catalog,
      models: catalog.models.map((entry) => ({ ...entry, availableThinkingLevels: ['off'] as const })),
    }
    await render(<ProviderSettings catalog={flat} {...allProps} />)
    expect(container.querySelector('select[aria-label^="Default reasoning level"]')).toBeNull()
  })
})

describe('provider runtime mutations', () => {
  function mountCatalogHook(options: {
    command: PtxApi['agent']['command']
    syncRuntime?: (runtimeId: string) => Promise<void>
    setEnabled?: PtxApi['providers']['setEnabled']
    setDisabled?: PtxApi['providers']['setDisabled']
    harness?: HarnessId
    reportError?: (error: unknown) => void
  }) {
    let value: ReturnType<typeof useProviderCatalog> | undefined
    const catalogMock = vi.fn().mockResolvedValue(catalog)
    const bridge = {
      agent: { command: options.command },
      providers: {
        catalog: catalogMock,
        onAuthEvent: vi.fn().mockReturnValue(() => undefined),
        setEnabled: options.setEnabled ?? vi.fn().mockResolvedValue(catalog),
        setDisabled: options.setDisabled ?? vi.fn().mockResolvedValue(catalog),
      },
    } as unknown as PtxApi
    const syncRuntime = options.syncRuntime ?? vi.fn().mockResolvedValue(undefined)
    const reportError = options.reportError ?? vi.fn()
    function Harness() {
      value = useProviderCatalog({ bridge, harness: options.harness, runtime, syncRuntime, reportError })
      return null
    }
    return render(<Harness />).then(() => ({ get value() { return value! }, catalogMock, syncRuntime, setDisabled: bridge.providers.setDisabled, reportError }))
  }

  it('serializes rapid reasoning changes and rolls back/synchronizes the latest rejection', async () => {
    const first = deferred<Record<string, unknown>>()
    const second = deferred<Record<string, unknown>>()
    const command = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = await mountCatalogHook({ command })

    act(() => { hook.value.changeEffort('low'); hook.value.changeEffort('high') })
    await act(async () => { await Promise.resolve() })
    expect(command).toHaveBeenCalledTimes(1)
    expect(hook.value.effort).toBe('high')

    await act(async () => { first.resolve({}); await first.promise; await Promise.resolve() })
    expect(command).toHaveBeenCalledTimes(2)
    expect(hook.syncRuntime).not.toHaveBeenCalled()

    await act(async () => { second.reject(new Error('thinking rejected')); try { await second.promise } catch { /* expected */ }; await Promise.resolve() })
    expect(hook.value.effort).toBe('low')
    expect(hook.syncRuntime).toHaveBeenCalledWith('runtime-1')
    expect(hook.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'thinking rejected' }))
  })

  it('rolls model state back and synchronizes after a rejected model command', async () => {
    const rejected = deferred<Record<string, unknown>>()
    const command = vi.fn().mockReturnValueOnce(rejected.promise)
    const hook = await mountCatalogHook({ command })

    act(() => hook.value.changeModel('openai-codex/gpt-5.5'))
    expect(hook.value.model).toBe('openai-codex/gpt-5.5')
    await act(async () => { rejected.reject(new Error('model rejected')); try { await rejected.promise } catch { /* expected */ }; await Promise.resolve() })

    expect(hook.value.model).toBe('openai-codex/gpt-5.6')
    expect(hook.value.effort).toBe('medium')
    expect(hook.syncRuntime).toHaveBeenCalledWith('runtime-1')
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('accepts main-owned provider enable persistence without writing settings again', async () => {
    const next = { ...catalog, providers: catalog.providers.map((provider) => provider.id === 'anthropic' ? { ...provider, enabled: true } : provider) }
    const setEnabled = vi.fn().mockResolvedValue(next)
    const hook = await mountCatalogHook({ command: vi.fn(), setEnabled })

    await act(async () => { await hook.value.setEnabled('anthropic', true) })
    expect(setEnabled).toHaveBeenCalledWith('anthropic', true, 'omp')
    expect(hook.value.catalog?.providers.find((provider) => provider.id === 'anthropic')?.enabled).toBe(true)
  })

  it('enables every provider with one atomic main-process mutation', async () => {
    const hook = await mountCatalogHook({ command: vi.fn() })

    await act(async () => { await hook.value.setAllEnabled() })
    expect(hook.setDisabled).toHaveBeenCalledWith([], 'omp')
  })

  it('applies a model stored default effort when it is selected', async () => {
    const command = vi.fn().mockResolvedValue({})
    const preferred = {
      ...catalog,
      models: catalog.models.map((entry) => entry.key === 'openai-codex/gpt-5.5' ? { ...entry, defaultThinkingLevel: 'high' as const } : entry),
    }
    const catalogMock = vi.fn().mockResolvedValue(preferred)
    const bridge = {
      agent: { command },
      providers: { catalog: catalogMock, setModelEnabled: vi.fn(), setModelEffort: vi.fn(), setEnabled: vi.fn(), setDisabled: vi.fn() },
    } as unknown as PtxApi
    // Stable identities: the hook re-fetches whenever its callbacks change.
    const syncRuntime = vi.fn().mockResolvedValue(undefined)
    const reportError = vi.fn()
    let value: ReturnType<typeof useProviderCatalog> | undefined
    function Harness() {
      value = useProviderCatalog({ bridge, runtime, syncRuntime, reportError })
      return null
    }
    await render(<Harness />)
    await act(async () => { await Promise.resolve() })

    act(() => value!.changeModel('openai-codex/gpt-5.5'))
    expect(value!.effort).toBe('high')
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(command).toHaveBeenCalledWith('runtime-1', { type: 'set_thinking_level', level: 'high' })
  })

  it('persists a cleared default without touching the live runtime', async () => {
    const command = vi.fn().mockResolvedValue({})
    const setModelEffort = vi.fn().mockResolvedValue(catalog)
    const bridge = {
      agent: { command },
      providers: { catalog: vi.fn().mockResolvedValue(catalog), setModelEnabled: vi.fn(), setModelEffort, setEnabled: vi.fn(), setDisabled: vi.fn() },
    } as unknown as PtxApi
    const syncRuntime = vi.fn().mockResolvedValue(undefined)
    const reportError = vi.fn()
    let value: ReturnType<typeof useProviderCatalog> | undefined
    function Harness() {
      value = useProviderCatalog({ bridge, runtime, syncRuntime, reportError })
      return null
    }
    await render(<Harness />)
    await act(async () => { await Promise.resolve() })

    await act(async () => { await value!.setModelEffort('openai-codex/gpt-5.6', '') })
    expect(setModelEffort).toHaveBeenCalledWith('openai-codex/gpt-5.6', '', 'omp')
    // The preference applies the next time the model is selected, never as a live command.
    expect(command).not.toHaveBeenCalled()
  })

  it('keeps the composer choice after the stored default was applied once', async () => {
    const command = vi.fn().mockResolvedValue({})
    const preferred = {
      ...catalog,
      models: catalog.models.map((entry) => entry.key === 'openai-codex/gpt-5.6' ? { ...entry, defaultThinkingLevel: 'high' as const } : entry),
    }
    const catalogMock = vi.fn().mockResolvedValue(preferred)
    const bridge = { agent: { command }, providers: { catalog: catalogMock, setModelEnabled: vi.fn(), setModelEffort: vi.fn(), setEnabled: vi.fn(), setDisabled: vi.fn() } } as unknown as PtxApi
    const syncRuntime = vi.fn().mockResolvedValue(undefined)
    const reportError = vi.fn()
    let value: ReturnType<typeof useProviderCatalog> | undefined
    function Harness() {
      value = useProviderCatalog({ bridge, runtime, syncRuntime, reportError })
      return null
    }
    await render(<Harness />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // The stored default reaches the agent exactly once.
    expect(command).toHaveBeenCalledWith('runtime-1', { type: 'set_thinking_level', level: 'high' })
    command.mockClear()

    // A session-level change is authoritative and survives a catalog refresh.
    act(() => value!.changeEffort('low'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { await value!.refresh(true) })
    expect(value!.effort).toBe('low')
    expect(command.mock.calls.filter(([, body]) => (body as { level?: string }).level === 'high')).toHaveLength(0)
  })

  it('keeps an optimistic fast-mode toggle across a catalog refresh', async () => {
    const hook = await mountCatalogHook({ command: vi.fn().mockResolvedValue({}) })
    await act(async () => { await Promise.resolve() })

    act(() => hook.value.changeFast(true))
    expect(hook.value.fast).toBe(true)

    // A refresh returns a new catalog object; the runtime's stale serviceTier must not revert the toggle.
    hook.catalogMock.mockResolvedValue({ ...catalog })
    await act(async () => { await hook.value.refresh(true) })

    expect(hook.value.fast).toBe(true)
  })

  it('disables every provider and clears an explicitly selected model in one atomic mutation', async () => {
    const hook = await mountCatalogHook({ command: vi.fn() })
    await act(async () => { await Promise.resolve() })

    await act(async () => { await hook.value.setAllDisabled() })
    expect(hook.setDisabled).toHaveBeenCalledWith(['anthropic', 'openai-codex'], 'omp')
    expect(hook.value.model).toBe('')
    expect(hook.value.fast).toBe(false)
  })

  it('routes OMP provider visibility to the OMP desktop-settings bucket', async () => {
    const next = { ...catalog, providers: catalog.providers.map((provider) => provider.id === 'anthropic' ? { ...provider, enabled: true } : provider) }
    const setEnabled = vi.fn().mockResolvedValue(next)
    const setDisabled = vi.fn().mockResolvedValue(next)
    const hook = await mountCatalogHook({ command: vi.fn(), harness: 'omp', setEnabled, setDisabled })

    await act(async () => { await hook.value.setEnabled('anthropic', true) })
    expect(setEnabled).toHaveBeenCalledWith('anthropic', true, 'omp')
    await act(async () => { await hook.value.setAllEnabled() })
    expect(setDisabled).toHaveBeenCalledWith([], 'omp')
  })

  it('routes Pi provider visibility to the Pi desktop-settings bucket', async () => {
    const next = { ...catalog, providers: catalog.providers.map((provider) => provider.id === 'anthropic' ? { ...provider, enabled: true } : provider) }
    const setEnabled = vi.fn().mockResolvedValue(next)
    const setDisabled = vi.fn().mockResolvedValue(next)
    const hook = await mountCatalogHook({ command: vi.fn(), harness: 'pi', setEnabled, setDisabled })

    await act(async () => { await hook.value.setEnabled('anthropic', true) })
    expect(setEnabled).toHaveBeenCalledWith('anthropic', true, 'pi')
    await act(async () => { await hook.value.setAllEnabled() })
    expect(setDisabled).toHaveBeenCalledWith([], 'pi')
  })
})
