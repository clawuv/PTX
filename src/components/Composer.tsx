import { ArrowUp, AtSign, ChevronDown, Clock3, Command, Edit3, ImageIcon, MessageCirclePlus, Paperclip, Plus, Square, SquareTerminal, Trash2, X, Zap } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  BrowserAnnotation,
  MessageEnterAction,
  AgentModelDescriptor,
  AgentProviderDescriptor,
  AgentThinkingLevel,
  PromptDeliveryIntent,
  PromptImage,
  QueuedPrompt,
  SessionRecord,
  SkillRecord,
  TerminalPromptContext,
  TerminalSelectionContext,
} from '@/types/api'
import { appendAnnotationsToPrompt } from '@/lib/browser-annotations'
import { appendCapabilityRouting } from '@/lib/capability-mentions'
import { appendTerminalContextToPrompt } from '@/lib/terminal-context'
import { appendSessionRouting, findSessionMentions } from '@/lib/session-mentions'
import { clearComposerDraft, readComposerDraft, saveComposerDraft, takeComposerDraft } from '@/lib/composer-draft'
import { messageActionForKey } from '@/lib/message-shortcuts'
import { useI18n } from '@/lib/i18n'
import { useComposerImages } from '@/hooks/useComposerImages'
import { IconButton } from './ui'
import { ModelPicker } from './ModelPicker'

interface ComposerProps {
  busy: boolean
  submitting?: boolean
  loading?: boolean
  disabled?: boolean
  model: string
  effort: AgentThinkingLevel
  modelsByProvider: ReadonlyMap<string, AgentModelDescriptor[]>
  providers: AgentProviderDescriptor[]
  reasoningLevels: AgentThinkingLevel[]
  fast: boolean
  fastSupported: boolean
  fastAvailable: boolean
  /** Active harness agent name for tooltips ("Pi" / "OMP"). */
  agentName?: string
  /** Active harness short name for inline copy ("Pi" / "OMP"). */
  shortName?: string
  imageInputSupported: boolean
  /** Primary action for Enter; Ctrl/Cmd+Enter selects the opposite action. */
  messageEnterAction?: MessageEnterAction
  skills: SkillRecord[]
  /** Other sidebar sessions in the active project, available as @title references. */
  sessions?: SessionRecord[]
  /** Browser annotations auto-attach as a composer attachment while any exist. */
  annotations?: BrowserAnnotation[]
  /** The active terminal is visible as context; selected text expands this attachment. */
  terminalSelection?: TerminalSelectionContext
  /** Reads the active xterm buffer only at submit time, avoiding output-driven renderer updates. */
  getTerminalContext?(): TerminalPromptContext | undefined
  /** Messages accepted by the harness but waiting for a turn boundary. */
  queuedMessages?: QueuedPrompt[]
  /** Messages held inside the harness when it exposes only a count, not previews. */
  harnessQueuedMessageCount?: number
  /** A queued message leaves the tray via delete or via edit (which loads its text for rework). */
  onRemoveQueuedMessage?(message: QueuedPrompt): void
  /** Each bump submits the current draft immediately (Ctrl/Cmd+Enter from the annotation popover). */
  sendSignal?: number
  onModelChange(value: string): void
  onManageModels?(): void
  onEffortChange(value: AgentThinkingLevel): void
  onFastChange(value: boolean): void
  onSend(prompt: string, images: PromptImage[], intent: PromptDeliveryIntent): Promise<void> | void
  onStop(): Promise<void> | void
  onRemoveAnnotation?(id: string): void
  /** Called after a send that included the annotations, and by the attachment's remove control. */
  onClearAnnotations?(): void
  onClearTerminalSelection?(): void
  /** Stable per-workspace key; without it the composer keeps no draft of its own. */
  draftKey?: string
}

const commands = [
  { command: '/review', detail: 'composer.command.review' },
  { command: '/plan', detail: 'composer.command.plan' },
  { command: '/compact', detail: 'composer.command.compact' },
  { command: '/status', detail: 'composer.command.status' },
] as const

const MAX_IMAGE_PROMPT_BYTES = 2 * 1024 * 1024
/** Auto-grow ceiling for the prompt textarea; kept in sync with the CSS max-height. */
const MAX_TEXTAREA_HEIGHT = 240

const EMPTY_ANNOTATIONS: BrowserAnnotation[] = []
const noop = () => undefined

export const Composer = memo(function Composer({
  busy,
  submitting = false,
  loading = false,
  disabled,
  model,
  effort,
  modelsByProvider,
  providers,
  reasoningLevels,
  fast,
  fastSupported,
  fastAvailable,
  agentName = 'OMP',
  shortName = 'OMP',
  imageInputSupported,
  messageEnterAction = 'queue',
  skills,
  sessions = [],
  annotations = EMPTY_ANNOTATIONS,
  terminalSelection,
  getTerminalContext,
  queuedMessages = [],
  harnessQueuedMessageCount = 0,
  onRemoveQueuedMessage,
  sendSignal = 0,
  onModelChange,
  onManageModels,
  onEffortChange,
  onFastChange,
  onSend,
  onStop,
  onRemoveAnnotation = noop,
  onClearAnnotations = noop,
  onClearTerminalSelection = noop,
  draftKey,
}: ComposerProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(() => (draftKey ? readComposerDraft(draftKey)?.text : undefined) ?? takeComposerDraft())
  const planMode = /^\s*\/plan(?:\s|$)/.test(value)
  const [menu, setMenu] = useState<'add' | 'mention' | 'command' | null>(null)
  const [sessionReferenceIds, setSessionReferenceIds] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [terminalSelectionOpen, setTerminalSelectionOpen] = useState(false)
  const [pendingQueueSendIds, setPendingQueueSendIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const imageAttachments = useComposerImages({ shortName })
  const { images, imagesRef, unsupportedFiles, unsupportedFilesRef, error: attachmentError, setError: setAttachmentError, processing: processingImages } = imageAttachments
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const acceptedMentionRef = useRef<{ start: number; text: string } | null>(null)
  const submittingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageStatusId = useId()
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const mountedRef = useRef(true)
  const restoredDraftRef = useRef(false)
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills])

  useEffect(() => {
    if (!draftKey || restoredDraftRef.current) return
    restoredDraftRef.current = true
    const draft = readComposerDraft(draftKey)
    if (!draft) return
    if (draft.model && draft.model !== model) onModelChange(draft.model)
    if (draft.effort && draft.effort !== effort) onEffortChange(draft.effort as AgentThinkingLevel)
    if (draft.fast !== undefined && draft.fast !== fast) onFastChange(draft.fast)
  }, [draftKey, effort, fast, model, onEffortChange, onFastChange, onModelChange])

  useEffect(() => {
    if (draftKey) saveComposerDraft(draftKey, { text: value, model, effort, fast })
  }, [draftKey, effort, fast, model, value])
  // The composer is bottom-anchored, so syncing the textarea height to its
  // content grows the composer upward instead of scrolling inside it.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    const mentionMatch = /(?:^|\s)@([^@\n]*)$/.exec(value)
    const mentionStart = mentionMatch ? value.length - mentionMatch[1].length - 1 : -1
    const acceptedMention = acceptedMentionRef.current
    const suppressAcceptedMention = Boolean(
      mentionMatch
      && acceptedMention
      && mentionStart === acceptedMention.start
      && value.slice(acceptedMention.start, acceptedMention.start + acceptedMention.text.length) === acceptedMention.text,
    )
    if (acceptedMention && !suppressAcceptedMention) acceptedMentionRef.current = null
    setMenu(value.startsWith('/') && !value.includes(' ') ? 'command' : mentionMatch && !suppressAcceptedMention ? 'mention' : null)
  }, [value])
  useEffect(() => {
    setSessionReferenceIds((current) => {
      if (!current.size) return current
      const mentionedTitles = new Set(findSessionMentions(value, sessions, current).map(({ session }) => session.title.trim().toLocaleLowerCase()))
      const next = new Map([...current].filter(([title]) => mentionedTitles.has(title)))
      return next.size === current.size ? current : next
    })
  }, [sessions, value])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    if (annotations.length === 0) setAnnotationsOpen(false)
  }, [annotations.length])
  useEffect(() => {
    if (!terminalSelection?.text) setTerminalSelectionOpen(false)
  }, [terminalSelection?.text])

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-composer-menu-trigger]')) return
      setMenu(null)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menu])

  // Ctrl/Cmd+Enter in the annotation popover bumps sendSignal to submit the
  // draft (with the just-saved annotation) without switching focus here.
  const lastSendSignalRef = useRef(sendSignal)
  useEffect(() => {
    if (sendSignal === lastSendSignalRef.current) return
    lastSendSignalRef.current = sendSignal
    void submit()
  }, [sendSignal])

  const submit = async (intent: PromptDeliveryIntent = 'queue', valueOverride?: string) => {
    const currentImages = imagesRef.current
    const currentUnsupportedFiles = unsupportedFilesRef.current
    const currentAnnotations = annotationsRef.current
    const currentTerminalContext = terminalSelection?.text ? getTerminalContext?.() : undefined
    const hasTerminalSelection = Boolean(currentTerminalContext?.text)
    const draftValue = valueOverride ?? value
    const prompt = draftValue.trim() || (currentImages.length > 0
      ? (currentImages.length === 1 ? '[Attached image]' : '[Attached images]')
      : currentUnsupportedFiles.length > 0 ? (currentUnsupportedFiles.length === 1 ? '[Attached file]' : '[Attached files]')
        : currentAnnotations.length > 0 ? '[Page annotations]' : '[Terminal selection]')
    if ((!draftValue.trim() && currentImages.length === 0 && currentUnsupportedFiles.length === 0 && currentAnnotations.length === 0 && !hasTerminalSelection) || loading || disabled || (intent !== 'steer' && !busy && (submitting || submittingRef.current))) return
    if (imageAttachments.hasPending()) {
      setAttachmentError(t('composer.error.processing'))
      return
    }
    if (currentUnsupportedFiles.length > 0) {
      const first = currentUnsupportedFiles[0]
      const remainder = currentUnsupportedFiles.length - 1
      setAttachmentError(remainder === 0
        ? t('composer.error.unsupportedFile', { name: first.name })
        : t('composer.error.unsupportedFiles', { name: first.name, count: remainder }))
      return
    }
    if (currentImages.length > 0 && !imageInputSupported) {
      setAttachmentError(t('composer.error.imagesUnsupported'))
      return
    }
    const submittedImages = currentImages.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
    // Recognized @ mentions carry explicit routing semantics; annotations then
    // ride along inside the prompt as their own delimited plain-text block.
    const referencedSessions = findSessionMentions(prompt, sessions, sessionReferenceIds)
    const sessionTitles = new Set(referencedSessions.map(({ session }) => session.title.trim().toLocaleLowerCase()))
    const promptWithSessions = appendSessionRouting(prompt, sessions, sessionReferenceIds)
    // If a session and capability share a display name, the session chosen
    // from the combined menu wins instead of silently routing both.
    const promptWithCapabilities = appendCapabilityRouting(promptWithSessions, enabledSkills.filter((skill) => !sessionTitles.has(skill.name.trim().toLocaleLowerCase())))
    const promptWithAnnotations = appendAnnotationsToPrompt(promptWithCapabilities, currentAnnotations)
    const promptWithContext = appendTerminalContextToPrompt(promptWithAnnotations, currentTerminalContext)
    const frame = `${JSON.stringify({ type: intent === 'steer' ? 'steer' : 'follow_up', message: promptWithContext, ...(submittedImages.length ? { images: submittedImages } : {}), id: '00000000-0000-0000-0000-000000000000' })}\n`
    if (new TextEncoder().encode(frame).byteLength > MAX_IMAGE_PROMPT_BYTES) {
      setAttachmentError(t('composer.error.tooLarge'))
      return
    }
    submittingRef.current = true
    const submittedValue = draftValue
    const submittedComposerImages = currentImages
    setValue('')
    imageAttachments.clear()
    setAttachmentError('')
    setMenu(null)
    try {
      await onSend(promptWithContext, submittedImages, intent)
      if (draftKey) clearComposerDraft(draftKey)
      // The annotations were delivered: clear the attachment and page markers.
      if (currentAnnotations.length > 0) onClearAnnotations()
    } catch {
      if (mountedRef.current) {
        setValue((current) => current || submittedValue)
        const restoration = imageAttachments.restoreWithinLimits(submittedComposerImages)
        if (restoration.omitted > 0) {
          const restoredImages = restoration.restored > 0 ? t('composer.error.restoredImages', { count: restoration.restored }) : ''
          setAttachmentError(t('composer.error.sendFailed.partial', { restored: restoredImages, count: restoration.omitted }))
        } else if (submittedComposerImages.length > 0) {
          setAttachmentError(t('composer.error.sendFailed.imagesRestored'))
        } else {
          setAttachmentError(t('composer.error.sendFailed.draftRestored'))
        }
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) textareaRef.current?.focus()
    }
  }

  const insertAtCaret = (textarea: HTMLTextAreaElement, text: string) => {
    const start = textarea.selectionStart ?? textarea.value.length
    const end = textarea.selectionEnd ?? textarea.value.length
    textarea.setRangeText(text, start, end, 'end')
    setValue(textarea.value)
  }
  const insert = (text: string) => {
    const textarea = textareaRef.current
    if (textarea) insertAtCaret(textarea, text)
    else setValue((current) => `${current}${text}`)
    setMenu(null)
    textarea?.focus()
  }
  const insertMention = (label: string, session?: SessionRecord) => {
    const textarea = textareaRef.current
    const match = /(?:^|\s)@([^@\n]*)$/.exec(value)
    if (!match) { insert(`@${label} `); return }
    const query = match[1]
    const start = value.length - query.length
    const mentionStart = start - 1
    const acceptedText = `@${label} `
    if (textarea) {
      textarea.setRangeText(`${label} `, start, value.length, 'end')
      acceptedMentionRef.current = { start: mentionStart, text: acceptedText }
      setValue(textarea.value)
    } else {
      acceptedMentionRef.current = { start: mentionStart, text: acceptedText }
      setValue(`${value.slice(0, start)}${label} `)
    }
    if (session) {
      const key = session.title.trim().toLocaleLowerCase()
      setSessionReferenceIds((current) => new Map(current).set(key, session.id))
    }
    setMenu(null)
    textarea?.focus()
  }

  const mentionQuery = /(?:^|\s)@([^@\n]*)$/.exec(value)?.[1]?.toLocaleLowerCase().trim() ?? ''

  const suggestions =
    menu === 'command'
      ? commands
          .filter((item) => item.command.startsWith(value))
          .map((item) => ({
            key: item.command,
            label: item.command,
            detail: t(item.detail),
            icon: <Command size={14} />,
            choose: () => {
              setValue(`${item.command} `)
              setMenu(null)
              textareaRef.current?.focus()
            },
          }))
      : menu === 'mention'
        ? [
            ...sessions.filter((session) => session.title.toLocaleLowerCase().includes(mentionQuery)).slice(0, 6).map((session) => ({
              key: `session:${session.harness}:${session.id}`,
              label: `@${session.title}`,
              detail: t('composer.mention.sessionDetail', { harness: session.harness.toUpperCase(), status: session.status }),
              icon: <MessageCirclePlus size={14} />,
              choose: () => insertMention(session.title, session),
            })),
            ...enabledSkills.filter((skill) => skill.name.toLocaleLowerCase().includes(mentionQuery)).slice(0, 6).map((skill) => ({
              key: `skill:${skill.id}`,
              label: `@${skill.name}`,
              detail: skill.description,
              icon: <AtSign size={14} />,
              choose: () => insertMention(skill.name),
            })),
          ].slice(0, 8)
        : menu === 'add'
          ? [
              { key: 'files', label: t('composer.add.files'), detail: t('composer.add.filesDetail'), icon: <Paperclip size={14} />, choose: () => { setMenu(null); fileInputRef.current?.click() } },
              { key: 'mention', label: t('composer.add.mention'), detail: t('composer.add.mentionDetail'), icon: <AtSign size={14} />, choose: () => insert('@') },
            ]
          : []

  useEffect(() => {
    setActiveSuggestion(0)
  }, [menu, value, suggestions.length])
  const chooseSuggestion = (index: number) => suggestions[index]?.choose()
  const sendQueuedMessageImmediately = async (queued: QueuedPrompt) => {
    // While the steer round-trip is in flight the item's actions stay disabled,
    // so a double-click cannot deliver the same queued message twice.
    setPendingQueueSendIds((current) => new Set(current).add(queued.id))
    try {
      await onSend(queued.text, [], 'steer')
      // Only remove from the tray once the message actually went out; a failed
      // steer must leave it in place so the user can retry instead of losing it.
      onRemoveQueuedMessage?.(queued)
    } catch {
      // sendPrompt reports the failure itself (system row + toast); the queued
      // item stays, and the composer points at it so the retry path is obvious.
      if (mountedRef.current) setAttachmentError(t('composer.error.sendFailed.queuedKept'))
    } finally {
      if (mountedRef.current) {
        setPendingQueueSendIds((current) => {
          const next = new Set(current)
          next.delete(queued.id)
          return next
        })
      }
    }
  }

  return (
    <div className="composer-wrap">
      {queuedMessages.length || harnessQueuedMessageCount ? (
        <section className="composer-queue" aria-label={t('composer.queue.title')} aria-live="polite">
          <div className="composer-queue__header">
            <span><Clock3 size={13} />{t('composer.queue.title')}</span>
            <strong>{queuedMessages.length + harnessQueuedMessageCount}</strong>
          </div>
          <div className="composer-queue__list">
            {queuedMessages.map((queued) => {
              const sendPending = pendingQueueSendIds.has(queued.id)
              return (
                <div className="composer-queue__item" key={queued.id}>
                  <span className="composer-queue__text">{queued.text}</span>
                  <span className="composer-queue__actions">
                    <button type="button" className="composer-queue__action" disabled={sendPending} aria-label={t('composer.queue.sendNowAria', { name: queued.text })} title={t('composer.queue.sendNow')} onClick={() => { void sendQueuedMessageImmediately(queued) }}><ArrowUp size={13} /></button>
                    <button type="button" className="composer-queue__action" disabled={sendPending} aria-label={t('composer.queue.editAria', { name: queued.text })} title={t('composer.queue.edit')} onClick={() => { onRemoveQueuedMessage?.(queued); setValue(queued.text); requestAnimationFrame(() => textareaRef.current?.focus()) }}><Edit3 size={13} /></button>
                    <button type="button" className="composer-queue__action composer-queue__action--delete" disabled={sendPending} aria-label={t('composer.queue.deleteAria', { name: queued.text })} title={t('composer.queue.delete')} onClick={() => onRemoveQueuedMessage?.(queued)}><Trash2 size={13} /></button>
                  </span>
                </div>
              )
            })}
            {harnessQueuedMessageCount ? (
              <div className="composer-queue__item composer-queue__item--harness">
                <span className="composer-queue__text">{t('composer.queue.harnessHolding', { name: agentName, count: harnessQueuedMessageCount })}</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      <div
        className={`composer ${busy || submitting ? 'composer--busy' : ''} ${imageAttachments.dragging ? 'composer--image-dragging' : ''}`}
        {...imageAttachments.dragHandlers}
      >
        {imageAttachments.dragging ? <div className="composer-drop-feedback" aria-hidden="true"><Paperclip size={18} />{t('composer.dropToAttach')}</div> : null}
        <div className="composer-input">
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled || loading}
            rows={1}
            placeholder={disabled ? t('composer.placeholder.disabled') : loading ? t('composer.placeholder.loading') : submitting ? t('composer.placeholder.starting', { name: shortName }) : t('composer.placeholder.ask', { name: shortName })}
            aria-label={t('composer.messageAria', { name: shortName })}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={Boolean(menu && suggestions.length)}
            aria-controls={menu ? menuId : undefined}
            aria-activedescendant={menu && suggestions.length ? `${menuId}-option-${activeSuggestion}` : undefined}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.items]
                .filter((item) => item.kind === 'file')
                .flatMap((item) => {
                  const file = item.getAsFile()
                  return file ? [file] : []
                })
              if (!files.length) return
              const pastedText = event.clipboardData.getData('text/plain')
              event.preventDefault()
              if (pastedText) insertAtCaret(event.currentTarget, pastedText)
              void imageAttachments.ingest(files)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') acceptedMentionRef.current = null
              if (menu && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setActiveSuggestion((current) => (event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length))
                return
              }
              if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && menu && suggestions.length) {
                event.preventDefault()
                chooseSuggestion(activeSuggestion)
                return
              }
              const intent = messageActionForKey(
                {
                  key: event.key,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                },
                messageEnterAction,
              )
              if (intent) {
                event.preventDefault()
                void submit(intent)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMenu(null)
              }
            }}
          />
        </div>
        {menu && suggestions.length ? (
          <div ref={menuRef} id={menuId} className="composer-menu" role="listbox" aria-label={menu === 'command' ? t('composer.menu.commands') : menu === 'mention' ? t('composer.menu.mentions') : t('composer.menu.add')}>
            {suggestions.map((suggestion, index) => (
              <button
                id={`${menuId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeSuggestion === index}
                className={activeSuggestion === index ? 'is-active' : ''}
                key={suggestion.key}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={suggestion.choose}
              >
                {suggestion.icon}
                <span>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.detail}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {annotationsOpen && annotations.length ? (
          <div className="composer-annotations" role="region" aria-label={t('composer.annotations.detailsAria')}>
            {annotations.map((annotation, index) => {
              return (
                <div className="composer-annotation" key={annotation.id}>
                  <span className="composer-annotation__badge" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="composer-annotation__body">
                    <p>{annotation.comment}</p>
                    {annotation.stale ? <small>{t('composer.annotations.stale')}</small> : null}
                  </div>
                  <button type="button" aria-label={t('composer.annotations.removeOne', { index: index + 1 })} onClick={() => onRemoveAnnotation(annotation.id)}>
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
        {terminalSelectionOpen && terminalSelection?.text ? (
          <div className="composer-terminal-selection" role="region" aria-label={t('composer.terminal.regionAria')}>
            <div>
              <SquareTerminal size={14} aria-hidden="true" />
              <strong>{terminalSelection.label}</strong>
              {terminalSelection.truncated ? <small>{t('composer.terminal.truncated')}</small> : null}
            </div>
            <pre>{terminalSelection.text}</pre>
          </div>
        ) : null}
        {images.length || unsupportedFiles.length || annotations.length || terminalSelection?.text ? (
          <div className="composer-attachments" aria-label={t('composer.attachments.regionAria')}>
            {annotations.length ? (
              <div className="composer-attachment composer-attachment--annotations" title={t('composer.annotations.title', { count: annotations.length })}>
                <button
                  type="button"
                  className="composer-attachment__expand"
                  aria-expanded={annotationsOpen}
                  aria-label={t('composer.annotations.inspect', { count: annotations.length })}
                  onClick={() => setAnnotationsOpen((open) => !open)}
                >
                  <MessageCirclePlus size={13} />
                  <span>{annotations.length}</span>
                  <ChevronDown size={11} className={annotationsOpen ? 'is-open' : ''} />
                </button>
                <button
                  type="button"
                  className="composer-attachment__clear"
                  aria-label={t('composer.annotations.remove')}
                  onClick={() => {
                    setAnnotationsOpen(false)
                    onClearAnnotations()
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {terminalSelection?.text ? (
              <div className="composer-attachment composer-attachment--terminal has-selection" title={t('composer.terminal.fromTitle', { name: terminalSelection.label })}>
                <button
                  type="button"
                  className="composer-attachment__expand"
                  aria-expanded={terminalSelectionOpen}
                  aria-label={t('composer.terminal.inspectAria', { name: terminalSelection.label })}
                  onClick={() => setTerminalSelectionOpen((open) => !open)}
                >
                  <SquareTerminal size={13} />
                  <span>{terminalSelection.label}</span>
                  <small>{t('composer.terminal.selected')}</small><ChevronDown size={11} className={terminalSelectionOpen ? 'is-open' : ''} />
                </button>
                <button type="button" className="composer-attachment__clear" aria-label={t('composer.terminal.clear')} onClick={onClearTerminalSelection}><X size={12} /></button>
              </div>
            ) : null}
            {images.map((image) => (
              <div className="composer-attachment" key={image.id}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
                <span>
                  <ImageIcon size={12} />
                  {image.name}
                </span>
                <button
                  type="button"
                  aria-label={t('composer.attachment.remove', { name: image.name })}
                  onClick={() => imageAttachments.remove(image.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {unsupportedFiles.map((file) => (
              <div className="composer-attachment" key={file.id}>
                <span>
                  <Paperclip size={12} />
                  {file.name}
                </span>
                <button
                  type="button"
                  aria-label={t('composer.attachment.remove', { name: file.name })}
                  onClick={() => imageAttachments.remove(file.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachmentError ? (
          <p className="composer-attachment-error" role="alert">
            {attachmentError}
          </p>
        ) : null}
        <p id={imageStatusId} className="sr-only" role="status" aria-live="polite">
          {imageAttachments.dragging ? t('composer.status.drop') : processingImages ? t('composer.status.adding') : images.length + unsupportedFiles.length ? t('composer.status.filesAttached', { count: images.length + unsupportedFiles.length }) : ''}
        </p>
        <div className="composer__footer">
          <div className="composer__controls">
            <IconButton
              label={t('composer.menu.add')}
              data-composer-menu-trigger
              aria-expanded={menu === 'add'}
              aria-controls={menu === 'add' ? menuId : undefined}
              onClick={() => {
                setMenu((current) => (current === 'add' ? null : 'add'))
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            >
              <Plus size={16} />
            </IconButton>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              multiple
              tabIndex={-1}
              aria-label={t('composer.chooseFiles')}
              aria-describedby={imageStatusId}
              disabled={disabled || loading || submitting}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void imageAttachments.ingest(files)
              }}
            />
            <button
              type="button"
              className={`composer-plan-mode${planMode ? ' is-active' : ''}`}
              aria-pressed={planMode}
              title={t('composer.planMode.title')}
              onClick={() => {
                setValue((current) => /^\s*\/plan(?:\s|$)/.test(current) ? current.replace(/^\s*\/plan\s*/, '') : `/plan${current.trim() ? ' ' : ''}${current}`)
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            >
              <span>{t('composer.planMode.label')}</span> <ChevronDown size={12} />
            </button>
            {fastSupported ? (
              <button
                type="button"
                className={`fast-mode-toggle ${fast ? 'is-active' : ''}`}
                aria-pressed={fast}
                disabled={!fastAvailable}
                title={fastAvailable ? t('composer.fast.title', { name: agentName }) : t('composer.fast.unavailable', { name: agentName })}
                onClick={() => onFastChange(!fast)}
              >
                <Zap size={12} fill={fast ? 'currentColor' : 'none'} /> <span className="fast-mode-toggle__label">{t('composer.fast.label')}</span>
              </button>
            ) : null}
          </div>
          <div className="composer__actions">
            <ModelPicker value={model} modelsByProvider={modelsByProvider} providers={providers} onChange={onModelChange} onManageModels={onManageModels}
              effort={effort} reasoningLevels={reasoningLevels} onEffortChange={onEffortChange} />
            {busy ? (
              <button type="button" className="send-button send-button--stop" aria-label={t('composer.stop')} onClick={() => void onStop()}>
                <Square size={12} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label={t('composer.send')}
                disabled={(!value.trim() && images.length === 0 && unsupportedFiles.length === 0 && annotations.length === 0 && !terminalSelection?.text) || processingImages || submitting || loading || disabled}
                onClick={() => void submit()}
              >
                <ArrowUp size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
