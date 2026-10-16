// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePanelLayout } from '../../src/hooks/usePanelLayout'

type PanelLayout = ReturnType<typeof usePanelLayout>

// usePanelLayout reads media queries and observes element sizes; jsdom offers neither.
const observers: { trigger(): void }[] = []

beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  class ResizeObserverStub {
    constructor(callback: () => void) {
      observers.push({ trigger: callback })
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

let sizeStub = { width: 0, height: 0 }
let latest: PanelLayout | undefined

function Harness() {
  const layout = usePanelLayout({ inspectorOpen: true, closeSmallestPanels: () => undefined, terminalOpen: false, view: 'session' })
  const { workspaceRowRef, sessionWorkspaceRef } = layout
  latest = layout
  useEffect(() => {
    if (workspaceRowRef.current && sessionWorkspaceRef.current) {
      Object.defineProperty(workspaceRowRef.current, 'clientWidth', { configurable: true, get: () => sizeStub.width })
      Object.defineProperty(sessionWorkspaceRef.current, 'clientHeight', { configurable: true, get: () => sizeStub.height })
    }
  })
  return (
    <div ref={workspaceRowRef}>
      <div ref={sessionWorkspaceRef} />
    </div>
  )
}

async function rowResized(width: number) {
  sizeStub = { width, height: 600 }
  await act(async () => {
    for (const observer of observers) observer.trigger()
  })
}

describe('panel layout inspector width', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('proportions the untouched inspector width to the window and keeps following resizes', async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    await rowResized(1200)
    // 30% of a 1200px row, above the 340px floor.
    expect(latest?.inspectorWidth).toBe(360)

    await rowResized(1600)
    expect(latest?.inspectorWidth).toBe(480)
    // Double-click reset is a fixed width, matching the sidebar default.
    expect(latest?.inspectorDefault).toBe(360)
  })

  it('pins the width once the user drags the handle', async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    await rowResized(1200)

    await act(async () => {
      latest?.markInspectorUserSet()
      latest?.setInspectorWidth(700)
    })
    await rowResized(1600)
    // The user's choice survives resizes and reloads; double-click still resets to the fixed default.
    expect(latest?.inspectorWidth).toBe(700)
    expect(latest?.inspectorDefault).toBe(360)
    expect(window.localStorage.getItem('prime-work.inspector-width-user-set')).toBe('1')
  })
})
