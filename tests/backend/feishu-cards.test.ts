import { expect, it } from 'vitest'
import { boundedCardText, cardJson, LiveReply, summarizeTools } from '../../electron/main/feishu/cards'

it('bounds unicode text and renders only collapsed tool summaries', () => {
  const text = boundedCardText('😀'.repeat(9000))
  expect(Array.from(text).length).toBeLessThan(8100)
  expect(text).toContain('完整回复请在电脑查看')
  const tools = summarizeTools([
    { type: 'toolCall', name: 'Read', args: { secret: 'private-args' } },
    { type: 'toolResult', name: 'Read', isError: true, text: 'private-output' },
  ])
  expect(tools).toEqual([{ name: 'Read', status: 'failed' }])
  const card = cardJson({ text, tools }, false)
  expect(card.body.elements[1]).toMatchObject({ tag: 'collapsible_panel', expanded: false })
  expect(JSON.stringify(card)).not.toContain('private-')
})

it('ignores reasoning, caps tool entries, and separates successive assistant messages', () => {
  const live = new LiveReply()
  live.apply({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private-reasoning' } })
  live.apply({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'first' } })
  live.apply({ type: 'message_start', message: { role: 'assistant' } })
  live.apply({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'second' } })
  for (let i = 0; i < 100; i++) live.apply({ type: 'tool_execution_start', toolName: 'Read', toolCallId: String(i), args: 'private-args' })
  expect(live.snapshot().text).toBe('first\n\nsecond')
  expect(live.snapshot().tools).toHaveLength(50)
  expect(JSON.stringify(live.snapshot())).not.toContain('private-')
})
