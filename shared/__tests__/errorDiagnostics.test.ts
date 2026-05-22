import { describe, expect, it } from 'vitest'
import { normalizeBlockedErrorDiagnostics } from '../errorDiagnostics'

describe('shared blocked error diagnostics', () => {
  it('redacts common credential patterns from diagnostic text', () => {
    const diagnostics = normalizeBlockedErrorDiagnostics({
      summary: [
        'Authorization: Bearer auth-token-123',
        'Authorization Bearer auth-token-456',
        'Bearer standalone-token-456',
        'api key: api-key-789',
        'api key api-key-word-form',
        'access_token=access-token-123',
        'refresh token=refresh-token-123',
        'password=hunter2',
        'secret is secret-token-123',
        'sk-openai-secret-123',
      ].join('\n'),
    })

    expect(diagnostics?.summary).toContain('[redacted]')
    expect(diagnostics?.summary).not.toContain('auth-token-123')
    expect(diagnostics?.summary).not.toContain('auth-token-456')
    expect(diagnostics?.summary).not.toContain('standalone-token-456')
    expect(diagnostics?.summary).not.toContain('api-key-789')
    expect(diagnostics?.summary).not.toContain('api-key-word-form')
    expect(diagnostics?.summary).not.toContain('access-token-123')
    expect(diagnostics?.summary).not.toContain('refresh-token-123')
    expect(diagnostics?.summary).not.toContain('hunter2')
    expect(diagnostics?.summary).not.toContain('secret-token-123')
    expect(diagnostics?.summary).not.toContain('sk-openai-secret-123')
  })

  it('normalizes model output truncation diagnostics and token counts', () => {
    const diagnostics = normalizeBlockedErrorDiagnostics({
      kind: 'model_output_truncated',
      source: 'opencode',
      summary: 'The model stopped because OpenCode reported finish reason "length".',
      finishReason: 'length',
      outputTokens: 2923,
      reasoningTokens: 29077,
      inputTokens: 13252,
    })

    expect(diagnostics).toMatchObject({
      kind: 'model_output_truncated',
      source: 'opencode',
      finishReason: 'length',
      outputTokens: 2923,
      reasoningTokens: 29077,
      inputTokens: 13252,
    })
  })

  it('normalizes OpenCode provider identity fields', () => {
    const diagnostics = normalizeBlockedErrorDiagnostics({
      kind: 'opencode_provider',
      source: 'provider',
      summary: 'Low Credit Warning!: Add credits to continue, or switch to a free model (HTTP 402)',
      providerId: 'kilo',
      providerModelId: 'kilo-auto/free',
    })

    expect(diagnostics).toMatchObject({
      providerId: 'kilo',
      providerModelId: 'kilo-auto/free',
    })
  })
})
