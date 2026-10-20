import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newestWindow } from '@/lib/render-bounds'
import type { TranscriptMessage } from '@/types/api'

export function useTranscriptScroll(messages: TranscriptMessage[]) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousCountRef = useRef(0)
  const previousStreamingRef = useRef(false)
  const pinnedToBottomRef = useRef(true)
  const [visibleLimit, setVisibleLimit] = useState(250)
  const [announcement, setAnnouncement] = useState('')
  // Reactive mirror of the pinned flag: drives the floating scroll-to-bottom control.
  const [scrolledUp, setScrolledUp] = useState(false)
  const streaming = messages.some((message) => message.streaming)
  const visibleMessages = useMemo(() => newestWindow(messages, visibleLimit), [messages, visibleLimit])
  const hiddenCount = messages.length - visibleMessages.length

  // Layout effect: the first pin must land before the browser paints, or a
  // remount flashes the top of the transcript before jumping down.
  useLayoutEffect(() => {
    const firstLoadedTranscript = previousCountRef.current === 0 && messages.length > 0
    const scroller = scrollRef.current
    let frame: number | undefined
    if (firstLoadedTranscript) {
      // Pin to bottom now, then re-assert for a few frames: after remounting
      // (e.g. returning from Settings) fonts, images, and layout settle late, so
      // a single scroll lands on a stale scrollHeight and leaves the view on top.
      pinnedToBottomRef.current = true
      let retries = 0
      const pin = () => {
        if (!scroller || typeof scroller.scrollTo !== 'function') return
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' })
        retries += 1
        if (retries <= 4) frame = requestAnimationFrame(pin)
      }
      pin()
    } else if (streaming && pinnedToBottomRef.current) {
      frame = requestAnimationFrame(() => scroller && typeof scroller.scrollTo === 'function' && scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }))
    }
    if (previousStreamingRef.current && !streaming) setAnnouncement('Agent response complete.')
    else if (!previousStreamingRef.current && streaming) setAnnouncement('The agent is working.')
    previousStreamingRef.current = streaming
    previousCountRef.current = messages.length
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [messages, streaming])

  const syncPinned = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
    pinnedToBottomRef.current = pinned
    setScrolledUp(!pinned)
  }

  const updatePinnedState = () => syncPinned()

  const scrollToBottom = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }

  const showEarlier = () => setVisibleLimit((limit) => Math.min(messages.length, limit + 250))

  return { announcement, hiddenCount, scrollRef, showEarlier, updatePinnedState, visibleMessages, scrolledUp, scrollToBottom }
}
