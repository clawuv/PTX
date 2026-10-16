import { useCallback, useMemo } from 'react'
import { detectedHarnesses as readDetectedHarnesses } from '@/lib/harness'
import type { HarnessId, PtxApi } from '@/types/api'
import { type UseBootstrapOptions, useBootstrap } from './useBootstrap'

type BootstrapOptions = Omit<UseBootstrapOptions, 'bridge' | 'ready' | 'harness'>
type HarnessRefreshResult = Awaited<ReturnType<PtxApi['app']['refreshHarnesses']>>

interface HarnessWorkspaceOptions extends BootstrapOptions {
  bridge: PtxApi | null
  ready: boolean
  harness: HarnessId
  reconcileExternalSettings(refresh: () => Promise<HarnessRefreshResult | null>): Promise<HarnessRefreshResult | null>
  refreshProvider(force: boolean): Promise<void>
}

/** Owns the harness-scoped bootstrap and the executable-discovery refresh path. */
export function useHarnessWorkspace({ bridge, ready, harness, reconcileExternalSettings, refreshProvider, ...bootstrapOptions }: HarnessWorkspaceOptions) {
  const { meta, initialized, refreshHarnesses } = useBootstrap({ bridge, ready, harness, ...bootstrapOptions })
  const detectedHarnesses = useMemo(() => readDetectedHarnesses(meta), [meta])
  const refreshDetectedHarnesses = useCallback(async () => {
    const result = await reconcileExternalSettings(refreshHarnesses)
    if (!result) return
    if (result.settings.activeHarness === harness && result.meta.harnesses[harness].path) await refreshProvider(true)
  }, [harness, reconcileExternalSettings, refreshHarnesses, refreshProvider])

  return { meta, initialized, refreshHarnesses, detectedHarnesses, refreshDetectedHarnesses }
}
