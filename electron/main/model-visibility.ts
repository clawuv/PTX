import type { AgentModelCatalog, AgentThinkingLevel } from '../../src/types/api'

/**
 * Applies Ptx's synchronized provider/model visibility policy to a raw harness
 * catalog, and decorates each model with the user's stored default reasoning
 * effort when that level is still offered.
 */
export function withModelVisibility(
  catalog: AgentModelCatalog,
  disabledProviders: ReadonlySet<string>,
  disabledModels: ReadonlySet<string>,
  modelEffort: ReadonlyMap<string, AgentThinkingLevel> = new Map(),
): AgentModelCatalog {
  const modelKeysByProvider = new Map<string, string[]>()
  for (const model of catalog.models) {
    const keys = modelKeysByProvider.get(model.provider)
    if (keys) keys.push(model.key)
    else modelKeysByProvider.set(model.provider, [model.key])
  }

  const providerEnabled = new Map(catalog.providers.map((provider) => {
    const modelKeys = modelKeysByProvider.get(provider.id)
    const hasEnabledModel = !modelKeys || modelKeys.some((key) => !disabledModels.has(key))
    return [provider.id, !disabledProviders.has(provider.id) && hasEnabledModel] as const
  }))

  return {
    ...catalog,
    models: catalog.models.map((model) => {
      const effort = modelEffort.get(model.key)
      return {
        ...model,
        enabled: providerEnabled.get(model.provider) !== false && !disabledModels.has(model.key),
        ...(effort && model.availableThinkingLevels.includes(effort) ? { defaultThinkingLevel: effort } : {}),
      }
    }),
    providers: catalog.providers.map((provider) => ({ ...provider, enabled: providerEnabled.get(provider.id) !== false })),
  }
}
