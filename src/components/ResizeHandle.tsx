import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

type Orientation = 'vertical' | 'horizontal'

interface ResizeHandleProps {
  orientation: Orientation
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange(value: number): void
  /** Flip drag/arrow direction for panels whose handle sits on their trailing edge (e.g. a left sidebar). */
  invert?: boolean
  /** Override the hover tooltip; pass null to disable it entirely. */
  tooltip?: string | null
  /** Live-resize scope: selector of the ancestor that carries the CSS variable. Defaults to the inspector/terminal behavior. */
  liveScope?: { selector: string; cssVariable: string }
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(min, max), Math.max(min, value)))

export function ResizeHandle({ orientation, label, value, min, max, defaultValue, onChange, invert = false, liveScope, tooltip }: ResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const lastPointerDownRef = useRef<{ coordinate: number; timestamp: number } | null>(null)
  const safeMax = Math.max(min, max)
  const readCoordinate = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => orientation === 'vertical' ? event.clientX : event.clientY
  const reset = (target: HTMLDivElement) => {
    const workspace = target.closest<HTMLElement>(liveScope?.selector ?? '.session-workspace')
    const cssVariable = liveScope?.cssVariable ?? (orientation === 'vertical' ? '--inspector-width' : '--terminal-height')
    workspace?.style.removeProperty(cssVariable)
    onChange(clamp(defaultValue, min, safeMax))
  }

  useEffect(() => () => cleanupRef.current?.(), [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 12
    const direction = invert ? -1 : 1
    let next: number | undefined
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = safeMax
    if (orientation === 'vertical' && event.key === 'ArrowLeft') next = value + step * direction
    if (orientation === 'vertical' && event.key === 'ArrowRight') next = value - step * direction
    if (orientation === 'horizontal' && event.key === 'ArrowUp') next = value + step
    if (orientation === 'horizontal' && event.key === 'ArrowDown') next = value - step
    if (next === undefined) return
    event.preventDefault()
    onChange(clamp(next, min, safeMax))
  }

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const coordinate = readCoordinate(event.nativeEvent)
    const previous = lastPointerDownRef.current
    if (previous && event.timeStamp - previous.timestamp < 350 && Math.abs(coordinate - previous.coordinate) < 4) {
      event.preventDefault()
      cleanupRef.current?.()
      lastPointerDownRef.current = null
      reset(event.currentTarget)
      return
    }
    lastPointerDownRef.current = { coordinate, timestamp: event.timeStamp }
    event.preventDefault()
    cleanupRef.current?.()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const startCoordinate = readCoordinate(event.nativeEvent)
    const startValue = value
    const workspace = target.closest<HTMLElement>(liveScope?.selector ?? '.session-workspace')
    const cssVariable = liveScope?.cssVariable ?? (orientation === 'vertical' ? '--inspector-width' : '--terminal-height')
    let latestValue = startValue
    target.dataset.resizing = 'true'
    document.body.classList.add(`is-resizing-${orientation}`)
    target.setPointerCapture(pointerId)

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      latestValue = clamp(startValue + (invert ? 1 : -1) * (readCoordinate(moveEvent) - startCoordinate), min, safeMax)
      workspace?.style.setProperty(cssVariable, `${latestValue}px`)
    }
    const finish = (finishEvent?: PointerEvent, commit = true) => {
      if (finishEvent && finishEvent.pointerId !== pointerId) return
      delete target.dataset.resizing
      document.body.classList.remove('is-resizing-vertical', 'is-resizing-horizontal')
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      cleanupRef.current = null
      if (commit && latestValue !== startValue) onChange(latestValue)
      else if (!commit) workspace?.style.setProperty(cssVariable, `${startValue}px`)
    }
    const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false)
    cleanupRef.current = () => finish(undefined, false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  return (
    <div
      className={`resize-handle resize-handle--${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={tooltip === undefined ? `${label} · double-click to reset` : tooltip || undefined}
      onDoubleClick={(event) => reset(event.currentTarget)}
      onKeyDown={handleKeyDown}
      onPointerDown={beginDrag}
    ><span aria-hidden="true" /></div>
  )
}
