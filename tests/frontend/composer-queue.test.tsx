// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../src/components/Composer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('composer queue tray', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows queued messages with immediate send, edit, and delete actions', async () => {
    const onSend = vi.fn()
    const onRemove = vi.fn()
    const queued = { id: 'queue-1', text: 'run tests', intent: 'queue' as const }
    act(() => root.render(<Composer
      busy
      submitting={false}
      loading={false}
      disabled={false}
      model="auto"
      effort="medium"
      modelsByProvider={new Map()}
      providers={[]}
      reasoningLevels={['medium']}
      fast={false}
      fastSupported={false}
      fastAvailable={false}
      imageInputSupported={true}
      messageEnterAction="queue"
      skills={[]}
      queuedMessages={[queued]}
      onRemoveQueuedMessage={onRemove}
      onModelChange={vi.fn()}
      onEffortChange={vi.fn()}
      onFastChange={vi.fn()}
      onSend={onSend}
      onStop={vi.fn()}
    />))

    const tray = container.querySelector('.composer-queue')
    expect(tray?.querySelectorAll('.composer-queue__item')).toHaveLength(1)
    expect(tray?.textContent).toContain('run tests')
    // The input card directly follows the queue tray; the context strip is gone.
    expect(tray?.nextElementSibling?.classList.contains('composer')).toBe(true)
    expect(container.querySelector('.composer-context-bar')).toBeNull()
    const actions = [...(tray?.querySelectorAll<HTMLButtonElement>('.composer-queue__action') ?? [])]
    expect(actions.map((action) => action.title)).toEqual([
      'Send queued message immediately',
      'Edit queued message',
      'Delete queued message',
    ])

    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label^="Send queued message immediately"]')?.click() })
    expect(onSend).toHaveBeenCalledWith('run tests', [], 'steer')

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Edit queued message"]')?.click())
    expect(onRemove).toHaveBeenCalledWith(queued)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('run tests')

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Delete queued message"]')?.click())
    expect(onRemove).toHaveBeenCalledWith(queued)
  })

  it('keeps a queued message in the tray when an immediate send fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('send failed'))
    const onRemove = vi.fn()
    const queued = { id: 'queue-1', text: 'run tests', intent: 'queue' as const }
    act(() => root.render(<Composer
      busy
      submitting={false}
      loading={false}
      disabled={false}
      model="auto"
      effort="medium"
      modelsByProvider={new Map()}
      providers={[]}
      reasoningLevels={['medium']}
      fast={false}
      fastSupported={false}
      fastAvailable={false}
      imageInputSupported={true}
      messageEnterAction="queue"
      skills={[]}
      queuedMessages={[queued]}
      onRemoveQueuedMessage={onRemove}
      onModelChange={vi.fn()}
      onEffortChange={vi.fn()}
      onFastChange={vi.fn()}
      onSend={onSend}
      onStop={vi.fn()}
    />))

    const tray = container.querySelector('.composer-queue')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label^="Send queued message immediately"]')?.click()
      // let the async onSend rejection settle
      await Promise.resolve()
    })

    // The tray row survives a failed send so the user can retry, and the
    // composer surfaces the failure instead of dropping the message quietly.
    expect(tray?.querySelectorAll('.composer-queue__item')).toHaveLength(1)
    expect(onRemove).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Message was not sent. It remains in the queue.')
  })

  it('ignores repeat immediate-send clicks while a send is in flight', () => {
    const onSend = vi.fn().mockReturnValue(new Promise(() => {}))
    const onRemove = vi.fn()
    const queued = { id: 'queue-1', text: 'run tests', intent: 'queue' as const }
    act(() => root.render(<Composer
      busy
      submitting={false}
      loading={false}
      disabled={false}
      model="auto"
      effort="medium"
      modelsByProvider={new Map()}
      providers={[]}
      reasoningLevels={['medium']}
      fast={false}
      fastSupported={false}
      fastAvailable={false}
      imageInputSupported={true}
      messageEnterAction="queue"
      skills={[]}
      queuedMessages={[queued]}
      onRemoveQueuedMessage={onRemove}
      onModelChange={vi.fn()}
      onEffortChange={vi.fn()}
      onFastChange={vi.fn()}
      onSend={onSend}
      onStop={vi.fn()}
    />))

    const sendNow = () => container.querySelector<HTMLButtonElement>('[aria-label^="Send queued message immediately"]')
    act(() => { sendNow()?.click() })
    // The second click lands on the now-disabled button: one in-flight send,
    // no double steer for the same queued message.
    act(() => { sendNow()?.click() })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(sendNow()?.disabled).toBe(true)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('shows messages held by a count-only harness queue', () => {
    act(() => root.render(<Composer
      busy
      submitting={false}
      loading={false}
      disabled={false}
      model="auto"
      effort="medium"
      modelsByProvider={new Map()}
      providers={[]}
      reasoningLevels={['medium']}
      fast={false}
      fastSupported={false}
      fastAvailable={false}
      agentName="OMP"
      imageInputSupported={true}
      skills={[]}
      harnessQueuedMessageCount={2}
      onModelChange={vi.fn()}
      onEffortChange={vi.fn()}
      onFastChange={vi.fn()}
      onSend={vi.fn()}
      onStop={vi.fn()}
    />))

    const tray = container.querySelector('.composer-queue')
    expect(tray?.querySelector('.composer-queue__header strong')?.textContent).toBe('2')
    expect(tray?.textContent).toContain('OMP is holding 2 messages for the next turn.')
  })

})
