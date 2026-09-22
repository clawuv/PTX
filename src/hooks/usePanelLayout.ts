import { useEffect, useRef, useState } from 'react'
import type { WorkspaceView } from '@/types/api'

export const INSPECTOR_MIN = 340
export const INSPECTOR_DEFAULT = 360
export const CHAT_MIN = 360
export const TERMINAL_MIN = 170
export const TERMINAL_DEFAULT = 310
export const WORKSPACE_ROW_MIN = 220
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 252
export const SMALLEST_LAYOUT_BREAKPOINT = 720
/** Untouched inspector width tracks this share of the workspace row, so the panel scales with the window. */
export const INSPECTOR_ROW_RATIO = 0.3
/** Double-clicking the divider resets to the compact inspector default. */
export const INSPECTOR_RESET_WIDTH = 360
const INSPECTOR_WIDTH_KEY = 'prime-work.inspector-width'
const INSPECTOR_USER_SET_KEY = 'prime-work.inspector-width-user-set'

const readPanelSize = (key: string, fallback: number) => {
  if (typeof window === 'undefined') return fallback
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

interface UsePanelLayoutOptions {
  inspectorOpen: boolean
  closeSmallestPanels(patch: { inspectorOpen?: false }): void
  terminalOpen: boolean
  view: WorkspaceView
}

export function usePanelLayout({
  inspectorOpen,
  closeSmallestPanels,
  terminalOpen,
  view,
}: UsePanelLayoutOptions) {
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 980px)').matches)
  const [smallestLayout, setSmallestLayout] = useState(() => window.matchMedia(`(max-width: ${SMALLEST_LAYOUT_BREAKPOINT}px)`).matches)
  const [smallestInspectorAllowed, setSmallestInspectorAllowed] = useState(false)
  // A drag on the resize handle pins the width in pixels; until then it follows the window proportionally.
  const [inspectorUserSet, setInspectorUserSet] = useState(() => window.localStorage.getItem(INSPECTOR_USER_SET_KEY) === '1')
  const inspectorUserSetRef = useRef(inspectorUserSet)
  inspectorUserSetRef.current = inspectorUserSet
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') return INSPECTOR_DEFAULT
    if (window.localStorage.getItem(INSPECTOR_USER_SET_KEY) === '1') return readPanelSize(INSPECTOR_WIDTH_KEY, INSPECTOR_DEFAULT)
    const sidebar = readPanelSize('prime-work.sidebar-width', SIDEBAR_DEFAULT)
    return Math.max(INSPECTOR_MIN, Math.round((window.innerWidth - sidebar) * INSPECTOR_ROW_RATIO))
  })
  const [terminalHeight, setTerminalHeight] = useState(() => readPanelSize('prime-work.terminal-height', TERMINAL_DEFAULT))
  const [sidebarWidth, setSidebarWidth] = useState(() => readPanelSize('prime-work.sidebar-width', SIDEBAR_DEFAULT))
  const [inspectorMax, setInspectorMax] = useState(660)
  const [terminalMax, setTerminalMax] = useState(520)
  const workspaceRowRef = useRef<HTMLDivElement>(null)
  const sessionWorkspaceRef = useRef<HTMLDivElement>(null)
  const inspectorSuppressed = smallestLayout && inspectorOpen && !smallestInspectorAllowed
  const visibleInspectorOpen = inspectorOpen && !inspectorSuppressed

  /** Pins the width after a user drag so window resizes stop re-proportioning it. */
  const markInspectorUserSet = () => {
    setInspectorUserSet(true)
    window.localStorage.setItem(INSPECTOR_USER_SET_KEY, '1')
  }

  useEffect(() => {
    const sync = () => {
      const smallestLayout = window.innerWidth <= SMALLEST_LAYOUT_BREAKPOINT
      setCompactLayout(window.innerWidth <= 980)
      setSmallestLayout(smallestLayout)
      if (smallestLayout) setSmallestInspectorAllowed(false)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (!smallestLayout) return
    if (inspectorSuppressed) closeSmallestPanels({ inspectorOpen: false })
  }, [closeSmallestPanels, inspectorSuppressed, smallestLayout])

  useEffect(() => {
    if (!compactLayout || !visibleInspectorOpen) return
    const selectors = window.innerWidth <= SMALLEST_LAYOUT_BREAKPOINT
      ? '.conversation-pane, .terminal-drawer, .session-workspace > .resize-handle'
      : '.title-toolbar, .conversation-pane, .terminal-drawer, .session-workspace > .resize-handle'
    const targets = [...document.querySelectorAll<HTMLElement>(selectors)]
    for (const target of targets) target.inert = true
    return () => { for (const target of targets) target.inert = false }
  }, [compactLayout, terminalOpen, visibleInspectorOpen])

  useEffect(() => {
    const row = workspaceRowRef.current
    const workspace = sessionWorkspaceRef.current
    if (!row || !workspace) return
    const syncBounds = () => {
      if (!window.matchMedia('(max-width: 980px)').matches) {
        const max = Math.max(INSPECTOR_MIN, row.clientWidth - CHAT_MIN)
        setInspectorMax(max)
        // Without a user-pinned width, the panel scales with the window.
        const fallback = Math.min(max, Math.max(INSPECTOR_MIN, Math.round(row.clientWidth * INSPECTOR_ROW_RATIO)))
        if (!inspectorUserSetRef.current) setInspectorWidth(fallback)
      }
      setTerminalMax(Math.max(TERMINAL_MIN, workspace.clientHeight - WORKSPACE_ROW_MIN))
    }
    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    observer.observe(row)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [inspectorOpen, terminalOpen, view])

  useEffect(() => setInspectorWidth((value) => Math.min(inspectorMax, Math.max(INSPECTOR_MIN, value))), [inspectorMax])
  useEffect(() => setTerminalHeight((value) => Math.min(terminalMax, Math.max(TERMINAL_MIN, value))), [terminalMax])
  useEffect(() => setSidebarWidth((value) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value))), [])
  useEffect(() => { window.localStorage.setItem('prime-work.inspector-width', String(inspectorWidth)) }, [inspectorWidth])
  useEffect(() => { window.localStorage.setItem('prime-work.terminal-height', String(terminalHeight)) }, [terminalHeight])
  useEffect(() => { window.localStorage.setItem('prime-work.sidebar-width', String(sidebarWidth)) }, [sidebarWidth])

  return {
    compactLayout,
    inspectorSuppressed,
    setSmallestInspectorAllowed,
    inspectorWidth,
    setInspectorWidth,
    markInspectorUserSet,
    inspectorDefault: INSPECTOR_RESET_WIDTH,
    terminalHeight,
    setTerminalHeight,
    sidebarWidth,
    setSidebarWidth,
    inspectorMax,
    terminalMax,
    workspaceRowRef,
    sessionWorkspaceRef,
  }
}
