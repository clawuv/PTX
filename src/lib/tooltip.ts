/**
 * Fast hover tooltips for icon buttons. Native `title` tooltips render after a
 * fixed ~1s Chromium delay that cannot be configured, so buttons carry the
 * presentation-only `data-tooltip` attribute instead (aria-labels keep the
 * accessible names) and this delegated controller shows a styled chip after a
 * short 300ms hover intent, flipping below when the top edge is too close.
 */

const SHOW_DELAY_MS = 300
const EDGE_GAP = 8
const ANCHOR_GAP = 6

export function installTooltips(): () => void {
  const tip = document.createElement('div')
  tip.className = 'app-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.style.display = 'none'
  document.body.append(tip)

  let timer: number | undefined
  let anchor: Element | null = null

  const hide = () => {
    window.clearTimeout(timer)
    timer = undefined
    anchor = null
    tip.style.display = 'none'
  }

  const place = (target: Element) => {
    const text = target.getAttribute('data-tooltip')
    if (!text || !target.isConnected) {
      hide()
      return
    }
    tip.textContent = text
    tip.style.display = 'block'
    const rect = target.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    let left = rect.left + rect.width / 2 - tipRect.width / 2
    left = Math.max(EDGE_GAP, Math.min(left, window.innerWidth - tipRect.width - EDGE_GAP))
    let top = rect.top - tipRect.height - ANCHOR_GAP
    if (top < EDGE_GAP) top = rect.bottom + ANCHOR_GAP
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
  }

  const onOver = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== 'mouse') return
    const target = (event.target as Element | null)?.closest?.('[data-tooltip]') ?? null
    if (target === anchor) return
    hide()
    if (!target) return
    anchor = target
    timer = window.setTimeout(() => place(target), SHOW_DELAY_MS)
  }

  const onOut = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== 'mouse') return
    if (anchor && !anchor.contains(event.relatedTarget as Node)) hide()
  }

  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('pointerdown', hide, true)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)

  return () => {
    hide()
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('pointerdown', hide, true)
    window.removeEventListener('scroll', hide, true)
    window.removeEventListener('blur', hide)
    tip.remove()
  }
}
