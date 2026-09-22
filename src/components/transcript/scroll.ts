import { useEffect, useMemo, useRef, useState } from 'react'
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

  useEffect(() => {
    const firstLoadedTranscript = previousCountRef.current === 0 && messages.length > 0
    const scroller = scrollRef.current
    let frame: number | undefined
    if (firstLoadedTranscript) {
      frame = requestAnimationFrame(() => scroller && typeof scroller.scrollTo === 'function' && scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }))
      pinnedToBottomRef.current = true
    } else if (streaming && pinnedToBottomRef.current) {
      frame = requestAnimationFrame(() => scroller && typeof scroller.scrollTo === 'function' && scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }))
    }
    if (previousStreamingRef.current && !streaming) setAnnouncement('Prime response complete.')
    else if (!previousStreamingRef.current && streaming) setAnnouncement('Prime is working.')
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
