/**
 * Harness API failures arrive in session transcripts as `<status>: {json}`
 * payloads (for example `400: {"type":"invalid_request_error","message":...}`).
 * Transcripts are read-only, so the raw payload is rewritten nowhere; render
 * surfaces call this helper to show the embedded human-readable message while
 * keeping the status code for context.
 */
export function apiErrorDetail(text: string): string | undefined {
  const match = /^(\d{3}):\s*(\{[\s\S]+\})\s*$/.exec(text)
  if (!match) return undefined
  try {
    const parsed: unknown = JSON.parse(match[2]!)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const nested = typeof record.error === 'object' && record.error !== null && !Array.isArray(record.error) ? record.error as Record<string, unknown> : undefined
    const message = [record.message, nested?.message].find((value) => typeof value === 'string' && value.trim()) as string | undefined
    return message ? `${match[1]} · ${message.trim()}` : undefined
  } catch {
    return undefined
  }
}
