import { describe, expect, it } from 'vitest'
import { withModelVisibility } from '../../electron/main/model-visibility'
import type { AgentModelCatalog } from '../../src/types/api'

const catalog: AgentModelCatalog = {
  harnessVersion: 'test',
  refreshedAt: '2026-08-13T00:00:00.000Z',
  providers: [{ id: 'openai', name: 'OpenAI', authMethod: 'external', configured: true, modelCount: 2, availableModelCount: 2, enabled: true }],
  models: [
    { key: 'openai/alpha', provider: 'openai', id: 'alpha', name: 'Alpha', reasoning: false, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
    { key: 'openai/beta', provider: 'openai', id: 'beta', name: 'Beta', reasoning: false, input: ['text'], contextWindow: 1, maxTokens: 1, availableThinkingLevels: ['off'], fastModeSupported: false, available: true },
  ],
}

describe('withModelVisibility', () => {
  it('turns every model off when its provider is off', () => {
    const result = withModelVisibility(catalog, new Set(['openai']), new Set())
    expect(result.providers[0].enabled).toBe(false)
    expect(result.models.map((model) => model.enabled)).toEqual([false, false])
  })

  it('keeps a provider on while any model is on and turns it off when none are on', () => {
    const partial = withModelVisibility(catalog, new Set(), new Set(['openai/beta']))
    expect(partial.providers[0].enabled).toBe(true)
    expect(partial.models.map((model) => model.enabled)).toEqual([true, false])

    const empty = withModelVisibility(catalog, new Set(), new Set(['openai/alpha', 'openai/beta']))
    expect(empty.providers[0].enabled).toBe(false)
    expect(empty.models.map((model) => model.enabled)).toEqual([false, false])
  })

  it('decorates only the models whose stored default is still offered', () => {
    const reasoning: AgentModelCatalog = {
      ...catalog,
      models: catalog.models.map((model) => ({ ...model, availableThinkingLevels: ['off', 'low', 'high'] })),
    }
    const result = withModelVisibility(reasoning, new Set(), new Set(), new Map([['openai/alpha', 'high'], ['openai/beta', 'max']]))
    expect(result.models[0].defaultThinkingLevel).toBe('high')
    // 'max' is not in beta's vocabulary, so the stale preference is dropped
    // instead of shipping a level the harness would reject.
    expect(result.models[1].defaultThinkingLevel).toBeUndefined()
  })

  it('leaves catalogs untouched when no effort preference is stored', () => {
    const result = withModelVisibility(catalog, new Set(), new Set())
    expect(result.models.every((model) => model.defaultThinkingLevel === undefined)).toBe(true)
  })
})
