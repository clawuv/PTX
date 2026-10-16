// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../../src/components/ModelPicker'
import { groupModelsByProvider } from '../../src/hooks/useProviderCatalog'
import type { AgentModelDescriptor, AgentProviderDescriptor } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const model = (key: string, provider: string, name: string, available = true): AgentModelDescriptor => ({
  key,
  provider,
  id: key.slice(key.indexOf('/') + 1),
  name,
  reasoning: true,
  input: ['text'],
  contextWindow: 200_000,
  maxTokens: 32_000,
  availableThinkingLevels: ['medium'],
  fastModeSupported: false,
  available,
})

const models = [
  model('openai/gpt-5.6-sol', 'openai', 'GPT-5.6 Sol'),
  model('openai/gpt-5.6-luna', 'openai', 'GPT-5.6 Luna'),
  model('anthropic/claude-opus-4-8', 'anthropic', 'Claude Opus 4.8'),
  model('anthropic/claude-sonnet-4-7', 'anthropic', 'Claude Sonnet 4.7', false),
]
const providers: AgentProviderDescriptor[] = [
  { id: 'openai', name: 'OpenAI', authMethod: 'oauth', configured: true, modelCount: 2, availableModelCount: 2, enabled: true },
  { id: 'anthropic', name: 'Anthropic', authMethod: 'api_key', configured: false, modelCount: 2, availableModelCount: 1, enabled: true },
]
const modelsByProvider = groupModelsByProvider(models)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function renderPicker(onChange = vi.fn()) {
  await act(async () => {
    root.render(<ModelPicker value="openai/gpt-5.6-sol" modelsByProvider={modelsByProvider} providers={providers} onChange={onChange} />)
  })
  return onChange
}

async function openPicker(): Promise<HTMLDivElement> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.model-picker__trigger')?.click()
  })
  return container.querySelector<HTMLDivElement>('.model-picker__popover')!
}

function optionLabels(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"] strong')].map((option) => option.textContent ?? '')
}

async function setSearch(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ModelPicker', () => {
  it('renders a compact menu without raw ids or provider filter controls', async () => {
    await renderPicker()
    const popover = await openPicker()

    expect(document.activeElement).toBe(popover)
    expect(popover.textContent).toContain('OpenAI · Anthropic')
    expect(optionLabels()).toEqual(['GPT-5.6 Sol', 'GPT-5.6 Luna', 'Claude Opus 4.8', 'Claude Sonnet 4.7'])
    expect(container.querySelector('.model-picker__providers')).toBeNull()
    expect(container.querySelector('input[type="search"]')).toBeNull()
    expect(popover.textContent).not.toContain('gpt-5.6-sol')
  })

  it('keeps provider labels only as simple group headings', async () => {
    await renderPicker()
    await openPicker()

    expect([...container.querySelectorAll('.model-picker__group-heading')].map((heading) => heading.textContent)).toEqual(['OpenAI', 'Anthropic'])
  })

  it('shows search only for larger model catalogs', async () => {
    const extendedModels = Array.from({ length: 9 }, (_, index) => model(`openai/model-${index}`, 'openai', `Model ${index}`))
    const singleProvider: AgentProviderDescriptor[] = [{ id: 'openai', name: 'OpenAI', authMethod: 'oauth', configured: true, modelCount: 9, availableModelCount: 9, enabled: true }]
    await act(async () => {
      root.render(<ModelPicker value="openai/model-0" modelsByProvider={groupModelsByProvider(extendedModels)} providers={singleProvider} onChange={vi.fn()} />)
    })
    await openPicker()
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!
    expect(document.activeElement).toBe(search)

    await setSearch(search, 'Model 8')
    expect(optionLabels()).toEqual(['Model 8'])
  })

  it('dismisses with Escape from the menu', async () => {
    await renderPicker()
    const popover = await openPicker()

    await act(async () => {
      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(container.querySelector('.model-picker__popover')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('.model-picker__trigger'))
  })

  it('dismisses when keyboard focus leaves the popover', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    await renderPicker()
    const popover = await openPicker()

    await act(async () => {
      outside.focus()
      popover.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
    })

    expect(container.querySelector('.model-picker__popover')).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('selects an available result from the keyboard and restores trigger focus', async () => {
    const onChange = await renderPicker()
    const popover = await openPicker()

    await act(async () => {
      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await act(async () => {
      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('openai/gpt-5.6-luna')
    expect(container.querySelector('.model-picker__popover')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('.model-picker__trigger'))
  })

  it('keeps unavailable models visible but prevents selection', async () => {
    const onChange = await renderPicker()
    await openPicker()
    const unavailable = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) => option.textContent?.includes('Claude Sonnet 4.7'))!
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')

    await act(async () => unavailable.click())
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('.model-picker__popover')).not.toBeNull()
  })

  it('opens the provider settings page from the model management footer', async () => {
    const onManageModels = vi.fn()
    await act(async () => {
      root.render(<ModelPicker value="openai/gpt-5.6-sol" modelsByProvider={modelsByProvider} providers={providers} onChange={vi.fn()} onManageModels={onManageModels} />)
    })
    await openPicker()

    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('.model-picker__manage')].at(0)?.click()
    })

    expect(onManageModels).toHaveBeenCalledOnce()
    expect(container.querySelector('.model-picker__popover')).toBeNull()
  })
})
