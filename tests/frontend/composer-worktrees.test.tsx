// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/components/Composer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function props(overrides: Record<string, unknown> = {}) {
  return {
    busy: false,
    model: '',
    effort: 'medium' as const,
    modelsByProvider: new Map(),
    providers: [],
    reasoningLevels: ['medium' as const],
    fast: false,
    fastSupported: false,
    fastAvailable: false,
    imageInputSupported: true,
    skills: [],
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    onFastChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

describe('composer selectors', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.sessionStorage.clear()
  })

  it('does not expose an automatic model choice before the catalog loads', () => {
    act(() => root.render(<Composer {...props()} />))

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Model: No model available"]')
    expect(trigger?.textContent).toContain('No model available')
    expect(trigger?.disabled).toBe(true)
  })

  it('restores an unsent draft and model after the composer remounts', async () => {
    act(() => root.render(<Composer {...props({ draftKey: 'project:new', model: 'openai:chosen' })} />))
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Keep this prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => root.unmount())
    root = createRoot(container)
    const onModelChange = vi.fn()
    act(() => root.render(<Composer {...props({ draftKey: 'project:new', model: '', onModelChange })} />))
    expect(container.querySelector('textarea')?.value).toBe('Keep this prompt')
    expect(onModelChange).toHaveBeenCalledWith('openai:chosen')
  })
})
