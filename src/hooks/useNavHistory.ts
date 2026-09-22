import { useCallback, useEffect, useRef, useState } from 'react'

export interface NavHistoryControls {
  canBack: boolean
  canForward: boolean
  back(): void
  forward(): void
}

interface NavHistoryState<T> {
  stack: T[]
  index: number
}

/**
 * Titlebar back/forward: records each distinct location as the app navigates and
 * replays them through `go`. Locations are compared via `keyOf`, so traversal is
 * a no-op when `go` lands back on an equivalent location.
 */
export function useNavHistory<T>(location: T, keyOf: (location: T) => string, go: (location: T) => void, limit = 50): NavHistoryControls {
  const [state, setState] = useState<NavHistoryState<T>>(() => ({ stack: [location], index: 0 }))
  const stateRef = useRef(state)
  stateRef.current = state
  const locationRef = useRef(location)
  locationRef.current = location
  const keyOfRef = useRef(keyOf)
  keyOfRef.current = keyOf
  const goRef = useRef(go)
  goRef.current = go
  // Set while a traversal is in flight so the push effect ignores the location it itself produced.
  const expectedKeyRef = useRef<string | null>(null)
  const key = keyOf(location)

  useEffect(() => {
    if (expectedKeyRef.current !== null && expectedKeyRef.current === key) {
      expectedKeyRef.current = null
      return
    }
    expectedKeyRef.current = null
    setState((current) => {
      if (keyOfRef.current(current.stack[current.index]) === key) return current
      const stack = [...current.stack.slice(0, current.index + 1), locationRef.current].slice(-limit)
      return { stack, index: stack.length - 1 }
    })
  }, [key, limit])

  const traverse = useCallback((delta: number) => {
    const current = stateRef.current
    const index = current.index + delta
    if (index < 0 || index >= current.stack.length) return
    const target = current.stack[index]
    expectedKeyRef.current = keyOfRef.current(target)
    stateRef.current = { ...current, index }
    setState(stateRef.current)
    goRef.current(target)
  }, [])

  const back = useCallback(() => traverse(-1), [traverse])
  const forward = useCallback(() => traverse(1), [traverse])
  return { canBack: state.index > 0, canForward: state.index < state.stack.length - 1, back, forward }
}
