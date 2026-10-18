import { describe, expect, it } from 'vitest'
import { apiErrorDetail } from '../../src/lib/harness-error-text'

describe('apiErrorDetail', () => {
  it('surfaces the embedded message of a `<status>: {json}` failure payload', () => {
    expect(apiErrorDetail('400: {"param":null,"type":"invalid_request_error","message":"Upstream request failed: [invalid_parameter_error] <400> InternalError.Algo.InvalidParameter: Range of max_tokens should be [1, 131072]"}'))
      .toBe('400 · Upstream request failed: [invalid_parameter_error] <400> InternalError.Algo.InvalidParameter: Range of max_tokens should be [1, 131072]')
  })

  it('reads the nested Anthropic-style error envelope and trims the message', () => {
    expect(apiErrorDetail('429: {"type":"error","error":{"type":"rate_limit_error","message":"  Too many requests.  "}}'))
      .toBe('429 · Too many requests.')
  })

  it('keeps the raw text for non-JSON bodies, missing messages, and malformed payloads', () => {
    expect(apiErrorDetail('400: {"type":"invalid_request_error"}')).toBeUndefined()
    expect(apiErrorDetail('400: [1, 2, 3]')).toBeUndefined()
    expect(apiErrorDetail('400: {"message":')).toBeUndefined()
    expect(apiErrorDetail('The agent stopped unexpectedly (exit 1).')).toBeUndefined()
    expect(apiErrorDetail('')).toBeUndefined()
  })
})
