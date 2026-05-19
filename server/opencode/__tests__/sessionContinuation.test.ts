import { describe, expect, it } from 'vitest'
import { OPENCODE_PROVIDER_AUTH_FAILED } from '@shared/errorCodes'
import type { BlockedErrorDiagnostics } from '@shared/errorDiagnostics'
import { isContinuableBlockedError } from '../sessionContinuation'

function diagnostics(input: Partial<BlockedErrorDiagnostics>): BlockedErrorDiagnostics {
  return {
    kind: 'opencode_provider',
    source: 'provider',
    summary: 'temporary provider failure',
    sessionId: 'ses-continue',
    ...input,
  }
}

describe('session continuation eligibility', () => {
  it.each([
    ['usage limit retryable signal', diagnostics({ summary: 'usage limit has been reached', isRetryable: true })],
    ['HTTP 429 rate limit', diagnostics({ summary: 'rate limit exceeded', statusCode: 429 })],
    ['HTTP 503 overload', diagnostics({ summary: 'service overloaded', statusCode: 503 })],
    ['HTTP 529 capacity', diagnostics({ summary: 'model is overloaded', statusCode: 529 })],
    ['timeout', diagnostics({ kind: 'timeout', source: 'opencode', summary: 'Timeout' })],
    ['transport failure', diagnostics({ kind: 'transport', source: 'opencode', summary: 'fetch failed: connection reset' })],
  ])('accepts %s', (_label, candidate) => {
    expect(isContinuableBlockedError({ diagnostics: candidate, errorCodes: [] })).toBe(true)
  })

  it.each([
    ['auth code', diagnostics({ summary: 'rate limit text but auth failed' }), [OPENCODE_PROVIDER_AUTH_FAILED]],
    ['HTTP 401', diagnostics({ summary: 'rate limit text but HTTP 401', statusCode: 401 }), []],
    ['invalid request', diagnostics({ summary: 'invalid_request: payload is invalid', statusCode: 400 }), []],
    ['billing', diagnostics({ summary: 'billing account disabled', isRetryable: true }), []],
    ['insufficient quota', diagnostics({ summary: 'insufficient_quota: quota exhausted', isRetryable: true }), []],
  ])('rejects %s', (_label, candidate, errorCodes) => {
    expect(isContinuableBlockedError({ diagnostics: candidate, errorCodes })).toBe(false)
  })

  it('rejects retryable diagnostics without a session id', () => {
    expect(isContinuableBlockedError({
      diagnostics: diagnostics({ sessionId: undefined, statusCode: 429 }),
      errorCodes: [],
    })).toBe(false)
  })
})
