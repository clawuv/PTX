import { describe, expect, it } from 'vitest'
import { turnAnchorId } from '../../src/app/turn-anchor'

describe('turnAnchorId', () => {
  it('anchors to the first message in the most recent assistant group', () => {
    expect(
      turnAnchorId([
        { id: 'user-1', role: 'user' },
        { id: 'assistant-1', role: 'assistant' },
        { id: 'assistant-2', role: 'assistant' },
        { id: 'user-2', role: 'user' },
        { id: 'assistant-3', role: 'assistant' },
        { id: 'assistant-4', role: 'assistant' },
      ]),
    ).toBe('assistant-3')
  })

  it('returns undefined when no assistant message exists', () => {
    expect(turnAnchorId([{ id: 'user-1', role: 'user' }])).toBeUndefined()
  })
})
