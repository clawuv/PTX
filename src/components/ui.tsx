import { Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/lib/i18n'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'small' | 'regular'
}

export function IconButton({ label, size = 'regular', className = '', children, ...props }: IconButtonProps) {
  return (
    <button type="button" className={`icon-button icon-button--${size} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function BrowserGlobe({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="browser-globe"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="3.65" ry="9" />
      <path d="M3 12h18" />
    </svg>
  )
}

export interface SelectMenuOption {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

interface SelectMenuProps {
  value: string
  options: ReadonlyArray<SelectMenuOption>
  onChange(value: string): void
  /** Accessible name and trigger tooltip. */
  label: string
  icon?: ReactNode
  /** Composer quiet-chip appearance instead of the boxed form control. */
  compact?: boolean
  className?: string
  disabled?: boolean
}

// Select-only combobox (ARIA): focus stays on the trigger while the listbox
// floats in a portal and aria-activedescendant tracks the highlighted option.
// The popover is fixed-positioned from the trigger rect so scrolling forms and
// modal overflow can never clip it, flipping above when the viewport ends.
export function SelectMenu({ value, options, onChange, label, icon, compact, className = '', disabled }: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<{ left: number; top: number; minWidth: number; maxHeight: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = options.find((option) => option.value === value)

  const place = () => {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const height = popover?.offsetHeight ?? 0
    const margin = 8
    const minWidth = Math.min(Math.max(rect.width, 160), window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - minWidth - margin))
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    // Prefer below the trigger; flip above when it does not fit and the top has more room.
    let top = rect.bottom + 5
    let maxHeight = Math.min(280, spaceBelow)
    if (popover && height > spaceBelow && spaceAbove > spaceBelow) {
      top = Math.max(margin, rect.top - height - 5)
      maxHeight = Math.min(280, spaceAbove)
    }
    setPlacement((current) => (current && current.left === left && current.top === top && current.maxHeight === maxHeight ? current : { left, top, minWidth, maxHeight }))
  }
  useLayoutEffect(() => {
    if (!open) return
    place()
    const frame = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      if (wrapperRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
  }, [open])
  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(`${listboxId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listboxId, open])

  const firstEnabledIndex = () => {
    for (let index = 0; index < options.length; index += 1) if (!options[index].disabled) return index
    return 0
  }
  const lastEnabledIndex = () => {
    for (let index = options.length - 1; index >= 0; index -= 1) if (!options[index].disabled) return index
    return Math.max(0, options.length - 1)
  }
  const step = (from: number, delta: 1 | -1) => {
    const count = options.length
    if (!count) return from
    let index = (from + delta + count) % count
    while (options[index].disabled && index !== from) index = (index + delta + count) % count
    return index
  }
  const openMenu = () => {
    const index = Math.max(0, options.findIndex((option) => option.value === value))
    setActive(options[index]?.disabled ? step(index, 1) : index)
    setOpen(true)
  }
  const commit = (option: SelectMenuOption) => {
    if (option.disabled) return
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
    if (option.value !== value) onChange(option.value)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => step(current, 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => step(current, -1)) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(firstEnabledIndex()) }
    else if (event.key === 'End') { event.preventDefault(); setActive(lastEnabledIndex()) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const option = options[active]; if (option) commit(option) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapperRef} className={`select-menu${compact ? ' select-menu--compact' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        ref={triggerRef}
        className="select-menu__trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${active}` : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
        data-value={value}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {icon ? <span className="select-menu__icon" aria-hidden="true">{icon}</span> : null}
        <span className="select-menu__value">{selected ? selected.label : label}</span>
        <ChevronDown className="select-menu__chevron" size={13} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div
          ref={popoverRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="select-menu__popover"
          style={placement ?? { visibility: 'hidden' }}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              id={`${listboxId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              className={`select-menu__option${index === active ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(option)}
            >
              <span className="select-menu__option-copy">
                <strong>{option.label}</strong>
                {option.detail ? <small>{option.detail}</small> : null}
              </span>
              {option.value === value ? <Check className="select-menu__check" size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>, document.body
      ) : null}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange(value: T): void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'is-active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h2>{title}</h2>
      <p>{children}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void): RefObject<T | null> {
  const containerRef = useRef<T>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  useEffect(() => {
    if (!active || !containerRef.current) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    const focusInitial = () => {
      const preferred = container.querySelector<HTMLElement>('[autofocus]')
      const first = preferred ?? container.querySelector<HTMLElement>(focusableSelector)
      first?.focus()
    }
    const frame = requestAnimationFrame(focusInitial)
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) return
      if (event.key === 'Escape' && escapeRef.current) { event.preventDefault(); escapeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => !item.hidden && item.getClientRects().length > 0)
      if (!items.length) { event.preventDefault(); container.focus(); return }
      const first = items[0]; const last = items.at(-1)!
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      const restore = previousFocus.current
      requestAnimationFrame(() => { if (restore?.isConnected) restore.focus() })
    }
  }, [active])
  return containerRef
}

// Overlays (modals, the command palette) share one refcount so stacked or
// sibling overlays only toggle the app shell's inert state on 0<->1 transitions.
let appShellOverlayCount = 0

export function useAppShellOverlay(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (!shell) return
    appShellOverlayCount += 1
    if (appShellOverlayCount === 1) { shell.inert = true; shell.setAttribute('aria-hidden', 'true') }
    return () => {
      appShellOverlayCount -= 1
      if (appShellOverlayCount === 0) { shell.inert = false; shell.removeAttribute('aria-hidden') }
    }
  }, [active])
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose(): void; footer?: ReactNode }) {
  const { t } = useI18n()
  const titleId = useId()
  const modalRef = useFocusTrap<HTMLElement>(true, onClose)
  useAppShellOverlay(true)
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__header"><h2 id={titleId}>{title}</h2><IconButton label={t('shellui.close')} onClick={onClose}><X size={16} /></IconButton></div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </section>
    </div>, document.body
  )
}

export function OmpMark({ size = 24 }: { size?: number }) {
  // The prong slots are cut out with a mask so the tile background shows
  // through, matching assets/brand/omp-icon.svg. useId keeps mask references
  // unique when several marks render at once (brand button plus its menu).
  const { t } = useI18n()
  const maskId = `omp-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span className="omp-mark" style={{ width: size, height: size }} role="img" aria-label={t('shellui.mark.omp')}>
      <svg viewBox="0 0 120 90" fill="none" focusable="false" aria-hidden="true">
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="120" height="90" fill="#fff" />
          <rect x="76" y="59" width="3" height="8" rx="1" fill="#000" />
          <rect x="82" y="59" width="3" height="8" rx="1" fill="#000" />
        </mask>
        <g mask={`url(#${maskId})`}>
          <rect x="10" y="8" width="100" height="12" rx="2" fill="currentColor" />
          <rect x="25" y="20" width="12" height="62" rx="2" fill="currentColor" />
          <rect x="75" y="20" width="12" height="45" rx="2" fill="currentColor" />
          <rect x="71" y="55" width="20" height="16" rx="3" fill="#f97316" />
        </g>
        <circle cx="18" cy="14" r="2" fill="#f97316" opacity="0.8" />
        <circle cx="102" cy="14" r="2" fill="#f97316" opacity="0.8" />
      </svg>
    </span>
  )
}

export function PiMark({ size = 24 }: { size?: number }) {
  // A plain geometric π: overhanging crossbar with two inset legs, drawn in
  // currentColor so the tile styling matches the other harness marks.
  const { t } = useI18n()
  return (
    <span className="pi-mark" style={{ width: size, height: size }} role="img" aria-label={t('shellui.mark.pi')}>
      <svg viewBox="0 0 120 90" fill="none" focusable="false" aria-hidden="true">
        <rect x="12" y="12" width="96" height="13" rx="2.5" fill="currentColor" />
        <rect x="31" y="25" width="13" height="53" rx="2.5" fill="currentColor" />
        <rect x="76" y="25" width="13" height="43" rx="2.5" fill="currentColor" />
        <path d="M76 68 h13 v4 a6 6 0 0 1 -6 6 h-1 a6 6 0 0 1 -6 -6 z" fill="currentColor" />
      </svg>
    </span>
  )
}

export function PtxMark({ size = 24 }: { size?: number }) {
  const { t } = useI18n()
  return (
    <span className="ptx-mark" style={{ width: size, height: size }} role="img" aria-label={t('shellui.mark.ptx')}>
      <img src={`${import.meta.env.BASE_URL}ptx-mascot.png`} alt="" aria-hidden="true" />
    </span>
  )
}
