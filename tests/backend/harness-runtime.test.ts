import { describe, expect, it } from 'vitest'
import { HARNESSES } from '../../electron/main/harness'
import { createHarnessRuntimeMap } from '../../electron/main/harness-runtime'

describe('harness runtime registry', () => {
  it('publishes one immutable service bundle for every harness', () => {
    const services = { projects: {}, sessions: {}, agents: {}, catalog: {}, plugins: {} }
    const registry = createHarnessRuntimeMap({ omp: services as never, pi: services as never })

    expect(Object.keys(registry)).toEqual(['omp', 'pi'])
    expect(registry.pi.id).toBe('pi')
    expect(Object.isFrozen(registry)).toBe(true)
    expect(Object.isFrozen(registry.pi)).toBe(true)
  })

  it('keeps capability differences in the harness descriptor', () => {
    expect(HARNESSES.omp.capabilities.approvalModeOverride).toBe(true)
    expect(HARNESSES.pi.capabilities.nativeMcp).toBe(false)
  })
})
