import { ArrowDown, LoaderCircle } from 'lucide-react'
import { useMemo } from 'react'
import type { TurnChanges } from '@/hooks/useTurnChanges'
import { EMPTY_TURN_FALLBACK } from '@/lib/events/reduce'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { useI18n } from '@/lib/i18n'
import type { HarnessId, TranscriptMessage } from '@/types/api'
import { ChangesCard } from './ChangesCard'
import { ErrorBoundary } from './ErrorBoundary'
import { MarkdownText } from './MarkdownText'
import { ActivityMessage, AgentMessage, AssistantMessage, GoalMessage, SteerReadMarker, UserMessage } from './transcript/messages'
import { useTranscriptScroll } from './transcript/scroll'
import { LiveElapsed, ThinkingDots, WorkDisclosure } from './transcript/timeline'
import { OmpMark, PiMark } from './ui'

export { tokenizeSyntax } from './transcript/syntax'
export { classifyTool, formatWorkedDuration } from './transcript/timeline'

export function coalesceAssistantTurns(messages: TranscriptMessage[]): TranscriptMessage[] {
  let changed = false
  const grouped: TranscriptMessage[] = []
  for (const message of messages) {
    const previous = grouped.at(-1)
    if (message.role !== 'assistant' || previous?.role !== 'assistant') {
      grouped.push(message)
      continue
    }
    changed = true
    const streaming = Boolean(previous.streaming || message.streaming)
    grouped[grouped.length - 1] = {
      ...previous,
      completedAt: streaming ? undefined : (message.completedAt ?? previous.completedAt),
      streaming,
      parts: [...previous.parts, ...message.parts],
    }
  }
  return changed ? grouped : messages
}

interface TranscriptProps {
  messages: TranscriptMessage[]
  /** Active harness; brands the assistant marks and working copy. */
  harness?: HarnessId
  /** Display name of the active project; headlines the empty-session welcome. */
  projectName?: string
  loading?: boolean
  active?: boolean
  showReasoning?: boolean
  showTools?: boolean
  onOpenChanges(): void
  onSuggestion(prompt: string): void
  suggestionsDisabled?: boolean
  /** Per-turn change summaries written into the flow when each turn ends, keyed by their anchor message. */
  turnChanges?: TurnChanges[]
  /** Repository directory and read-only flag for the changes cards' undo action. */
  changesCwd?: string
  changesReadOnly?: boolean
  onRefreshGit?(): Promise<void> | void
  /** Reserve room for queued-message affordances docked above the composer. */
  queuedMessageCount?: number
  onOpenSessionReference?(sessionId: string, harness: HarnessId): void
}

const ASSISTANT_MARKS = { omp: OmpMark, pi: PiMark } satisfies Record<HarnessId, unknown>
function AssistantMark({ harness, size = 24 }: { harness: HarnessId; size?: number }) {
  const Mark = ASSISTANT_MARKS[harness]
  return <Mark size={size} />
}

type WelcomeCardKey = 'explore' | 'build' | 'review' | 'fix'
function WelcomeCardIcon({ card }: { card: WelcomeCardKey }) {
  const shared = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  if (card === 'explore') {
    return (
      <svg {...shared} aria-hidden="true" style={{ color: '#339cff' }}>
        <g transform="rotate(-45 12 12)">
          <path d="m3 11 18-5v12L3 13v-2z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </g>
      </svg>
    )
  }
  if (card === 'build') {
    return (
      <svg {...shared} aria-hidden="true" style={{ color: '#a070e0' }}>
        <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
        <path d="m18 15 4-4" />
        <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
      </svg>
    )
  }
  if (card === 'review') {
    return (
      <svg {...shared} aria-hidden="true" style={{ color: '#35b06f' }}>
        <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
        <path d="M21 3v5h-5" />
        <path d="m9.6 12 1.9 1.9 3.6-3.8" />
      </svg>
    )
  }
  return (
    <svg {...shared} aria-hidden="true" style={{ color: '#f0641f' }}>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M17.47 9c1.93-.2 3.53-1.9 3.53-4" />
      <path d="M22 13h-4" />
      <path d="M21 21c0-2.1-1.7-3.9-3.8-4" />
    </svg>
  )
}

const WELCOME_CARDS: readonly WelcomeCardKey[] = ['explore', 'build', 'review', 'fix']

function SessionWelcome({ harness, projectName, suggestionsDisabled, onSuggestion }: { harness: HarnessId; projectName?: string; suggestionsDisabled?: boolean; onSuggestion(prompt: string): void }) {
  const { t } = useI18n()
  return (
    <div className="session-welcome">
      <AssistantMark harness={harness} size={46} />
      <h1>
        {projectName ? (
          <>
            {t('welcome.title.before')} <span className="welcome-project">{projectName}</span> {t('welcome.title.after')}
          </>
        ) : (
          t('welcome.title.generic')
        )}
      </h1>
      <div className="hero-cards">
        {WELCOME_CARDS.map((card) => (
          <button key={card} type="button" className="hero-card" disabled={suggestionsDisabled} onClick={() => onSuggestion(t(`welcome.prompt.${card}`))}>
            <span className="hero-card__icon" aria-hidden="true">
              <WelcomeCardIcon card={card} />
            </span>
            <span className="hero-card__label">{t(`welcome.card.${card}`)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ActiveAssistantMessage({ message, harness, showReasoning, showTools }: { message: TranscriptMessage; harness: HarnessId; showReasoning: boolean; showTools: boolean }) {
  const { t } = useI18n()
  const visibleActivity = message.parts.some(
    (part) => (part.type === 'thinking' && showReasoning) || ((part.type === 'toolCall' || part.type === 'toolResult') && showTools) || part.type === 'agentMessage',
  )
  return (
    <article className="message message--assistant">
      <div className="message__content">
        {visibleActivity ? (
          <WorkDisclosure message={message} parts={message.parts} showReasoning={showReasoning} showTools={showTools} running />
        ) : (
          <>
            {message.parts.map((part, index) => (part.type === 'text' ? <MarkdownText key={index} text={part.text === EMPTY_TURN_FALLBACK ? t('transcript.emptyTurn') : part.text} /> : null))}
            <div className="streaming-state" aria-live="polite">
              <ThinkingDots /> {t('transcript.working', { name: HARNESS_SHORT_NAMES[harness] })} <LiveElapsed since={message.startedAt ?? message.timestamp} />
            </div>
          </>
        )}
      </div>
    </article>
  )
}

export function Transcript({
  messages,
  harness = 'omp',
  projectName,
  loading,
  active = false,
  showReasoning = true,
  showTools = true,
  onOpenChanges,
  onSuggestion,
  suggestionsDisabled,
  turnChanges = [],
  changesCwd,
  changesReadOnly,
  onRefreshGit,
  queuedMessageCount = 0,
  onOpenSessionReference,
}: TranscriptProps) {
  const groupedMessages = useMemo(() => coalesceAssistantTurns(messages), [messages])
  // Anchored records render inside their turn; records whose anchor message is
  // absent — a restored session whose live message ids were minted per visit —
  // keep their history visible as a trailing stack after the transcript.
  const messageIds = useMemo(() => new Set(groupedMessages.map((message) => message.id)), [groupedMessages])
  const changesByMessage = useMemo(() => {
    const map = new Map<string, TurnChanges>()
    for (const record of turnChanges) if (messageIds.has(record.messageId)) map.set(record.messageId, record)
    return map
  }, [turnChanges, messageIds])
  const trailingChanges = useMemo(() => turnChanges.filter((record) => !messageIds.has(record.messageId)), [turnChanges, messageIds])
  const { t } = useI18n()
  const { announcement, hiddenCount, scrollRef, showEarlier, updatePinnedState, visibleMessages, scrolledUp, scrollToBottom } = useTranscriptScroll(groupedMessages)
  const activeAssistantId = useMemo(() => (active && groupedMessages.at(-1)?.role === 'assistant' ? groupedMessages.at(-1)?.id : undefined), [active, groupedMessages])
  const showWelcome = !loading && messages.length === 0
  const transcriptClasses = ['transcript', 'scroll-area', showWelcome ? 'is-welcome' : '', queuedMessageCount > 0 ? 'has-queued-messages' : ''].filter(Boolean).join(' ')

  return (
    <>
      <div ref={scrollRef} className={transcriptClasses} aria-busy={loading} onScroll={updatePinnedState}>
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className="transcript__inner">
          {loading ? (
            <div className="transcript-loading">
              <LoaderCircle className="spin" size={16} /> {t('transcript.loading')}
            </div>
          ) : null}
          {showWelcome ? <SessionWelcome harness={harness} projectName={projectName} suggestionsDisabled={suggestionsDisabled} onSuggestion={onSuggestion} /> : null}
          {hiddenCount > 0 ? (
            <button type="button" className="transcript__show-earlier" onClick={showEarlier}>
              {t('transcript.showEarlier', { count: Math.min(250, hiddenCount) })}
            </button>
          ) : null}
          {visibleMessages.map((message) => (
            <ErrorBoundary
              key={message.id}
              fallback={
                <div className="message message--render-failure" role="note">
                  {t('transcript.renderFailure')}
                </div>
              }
            >
              {message.kind === 'steer-read-marker' ? (
                <SteerReadMarker message={message} />
              ) : message.role === 'user' ? (
                <UserMessage message={message} onOpenSessionReference={onOpenSessionReference} />
              ) : message.role === 'assistant' ? (
                message.streaming || message.id === activeAssistantId ? (
                  <ActiveAssistantMessage message={message} harness={harness} showReasoning={showReasoning} showTools={showTools} />
                ) : (
                  <AssistantMessage
                    message={message}
                    harness={harness}
                    showReasoning={showReasoning}
                    showTools={showTools}
                    changes={changesByMessage.get(message.id)}
                    changesCwd={changesCwd}
                    changesReadOnly={changesReadOnly}
                    onOpenChanges={onOpenChanges}
                    onRefreshGit={onRefreshGit}
                  />
                )
              ) : message.role === 'agent' ? (
                <AgentMessage message={message} />
              ) : message.role === 'goal' ? (
                <GoalMessage message={message} />
              ) : message.role === 'tool' || message.role === 'system' ? (
                <ActivityMessage message={message} harness={harness} />
              ) : (
                <div className={`message message--${message.role}`}>{message.parts.map((part, partIndex) => (part.type === 'text' ? <span key={partIndex}>{part.text}</span> : null))}</div>
              )}
            </ErrorBoundary>
          ))}
          {trailingChanges.map((record) => (
            <article key={record.key} className="message message--assistant">
              <div className="message__content">
                <ChangesCard git={{ isRepo: true, files: record.files }} cwd={changesCwd} readOnly={changesReadOnly} onOpenChanges={onOpenChanges} onRefreshGit={onRefreshGit} />
              </div>
            </article>
          ))}
          {active && !activeAssistantId ? (
            <article className="message message--assistant transcript-active-placeholder" aria-live="polite">
              <div className="streaming-state">
                <ThinkingDots /> {t('transcript.working', { name: HARNESS_SHORT_NAMES[harness] })}
              </div>
            </article>
          ) : null}
          <div />
        </div>
      </div>
      {scrolledUp ? (
        <button type="button" className="transcript-jump" aria-label={t('transcript.scrollToBottom')} title={t('transcript.scrollToBottom')} onClick={scrollToBottom}>
          <ArrowDown size={15} />
        </button>
      ) : null}
    </>
  )
}
