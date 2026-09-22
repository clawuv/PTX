import type { TranscriptMessage } from '@/types/api'

/** Returns the first assistant message id for the most recent grouped turn. */
export function turnAnchorId(messages: readonly Pick<TranscriptMessage, 'id' | 'role'>[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'assistant') continue
    let anchor = index
    while (anchor > 0 && messages[anchor - 1].role === 'assistant') anchor -= 1
    return messages[anchor].id
  }
  return undefined
}
