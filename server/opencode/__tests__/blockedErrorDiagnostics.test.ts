import { describe, expect, it } from 'vitest'
import {
  OPENCODE_PROVIDER_AUTH_FAILED,
  OPENCODE_PROVIDER_ERROR,
} from '@shared/errorCodes'
import {
  appendBlockedErrorDiagnosticsSummary,
  buildOpenCodeBlockedErrorDiagnostics,
} from '../blockedErrorDiagnostics'

describe('OpenCode blocked error diagnostics', () => {
  it('classifies provider auth failures from structured OpenCode error details', () => {
    const result = buildOpenCodeBlockedErrorDiagnostics({
      modelId: 'openai/gpt-5.3-codex',
      sessionId: 'ses-auth',
      responseMeta: {
        hasAssistantMessage: false,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
        sessionErrored: true,
        sessionError: 'Provider request failed',
        sessionErrorDetails: {
          name: 'APIError',
          data: {
            message: 'Your authentication token has been invalidated. Please try signing in again.',
            statusCode: 401,
            isRetryable: false,
            responseBody: JSON.stringify({
              error: {
                type: 'invalid_request_error',
                code: 'token_invalidated',
                message: 'Your authentication token has been invalidated. Please try signing in again.',
              },
            }),
          },
        },
      },
    })

    expect(result.errorCodes).toEqual([OPENCODE_PROVIDER_AUTH_FAILED])
    expect(result.diagnostics).toMatchObject({
      kind: 'opencode_provider',
      source: 'provider',
      modelId: 'openai/gpt-5.3-codex',
      sessionId: 'ses-auth',
      statusCode: 401,
      isRetryable: false,
      providerErrorType: 'invalid_request_error',
      providerErrorMessage: 'Your authentication token has been invalidated. Please try signing in again.',
    })
    expect(result.diagnostics?.summary).toContain('HTTP 401')
  })

  it('classifies non-auth provider failures generically', () => {
    const result = buildOpenCodeBlockedErrorDiagnostics({
      responseMeta: {
        hasAssistantMessage: true,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: true,
        latestAssistantWasStale: false,
        latestAssistantError: 'Model usage limit reached',
        latestAssistantErrorInfo: {
          name: 'AI_APICallError',
          statusCode: 429,
          isRetryable: true,
          responseErrorType: 'rate_limit_error',
          responseErrorMessage: 'Model usage limit reached',
        },
      },
    })

    expect(result.errorCodes).toEqual([OPENCODE_PROVIDER_ERROR])
    expect(result.diagnostics).toMatchObject({
      kind: 'opencode_provider',
      source: 'provider',
      statusCode: 429,
      isRetryable: true,
      providerErrorType: 'rate_limit_error',
      providerErrorMessage: 'Model usage limit reached',
    })
  })

  it('classifies plain OpenCode/provider error messages without structured metadata', () => {
    const result = buildOpenCodeBlockedErrorDiagnostics({
      error: new Error('rate_limit_error: Model usage limit reached (HTTP 429)'),
    })

    expect(result.errorCodes).toEqual([OPENCODE_PROVIDER_ERROR])
    expect(result.diagnostics).toMatchObject({
      kind: 'opencode_provider',
      source: 'provider',
      statusCode: 429,
      summary: 'rate_limit_error: Model usage limit reached (HTTP 429)',
    })
  })

  it('redacts sensitive raw values before diagnostics can be persisted', () => {
    const result = buildOpenCodeBlockedErrorDiagnostics({
      error: {
        name: 'APIError',
        data: {
          message: 'Provider failed',
          statusCode: 500,
          requestBodyValues: {
            apiKey: 'sk-secret-request-key',
          },
          responseBody: JSON.stringify({
            error: {
              type: 'server_error',
              message: 'token=sk-secret-response-token caused a provider failure',
            },
          }),
        },
      },
    })
    const serialized = JSON.stringify(result.diagnostics)

    expect(serialized).not.toContain('sk-secret-request-key')
    expect(serialized).not.toContain('sk-secret-response-token')
    expect(serialized).toContain('[redacted]')
  })

  it('appends an underlying error summary when it adds useful context', () => {
    const message = appendBlockedErrorDiagnosticsSummary('Relevant files scan failed validation after retry: empty', {
      kind: 'opencode_provider',
      source: 'provider',
      summary: 'rate_limit_error: Model usage limit reached (HTTP 429)',
    })

    expect(message).toContain('Relevant files scan failed validation')
    expect(message).toContain('Underlying OpenCode error: rate_limit_error')
  })
})
