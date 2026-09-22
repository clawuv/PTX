import type { HarnessId } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import type { ModelCatalogProvider } from './model-catalog'
import type { PluginService } from './plugins'
import type { ProjectService } from './projects'
import type { SessionService } from './sessions'

/** The services that are owned by one agent harness and must never cross scopes. */
export interface HarnessRuntime {
  readonly id: HarnessId
  readonly projects: ProjectService
  readonly sessions: SessionService
  readonly agents: AgentRpcManager
  readonly catalog: ModelCatalogProvider
  readonly plugins: PluginService
}

export type HarnessRuntimeMap = Readonly<Record<HarnessId, HarnessRuntime>>

/**
 * Publishes the complete harness set as one typed registry. Keeping this
 * assembly object immutable makes missing wiring a compile-time error when a
 * harness is added and gives consumers one lookup instead of parallel fields.
 */
export function createHarnessRuntimeMap(
  runtimes: Record<HarnessId, Omit<HarnessRuntime, 'id'>>,
): HarnessRuntimeMap {
  return Object.freeze({
    prime: Object.freeze({ id: 'prime', ...runtimes.prime }),
    omp: Object.freeze({ id: 'omp', ...runtimes.omp }),
    pi: Object.freeze({ id: 'pi', ...runtimes.pi }),
  }) satisfies HarnessRuntimeMap
}
