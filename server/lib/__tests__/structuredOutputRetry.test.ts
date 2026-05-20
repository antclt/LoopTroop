import { describe, expect, it } from 'vitest'
import { getStructuredRetryDecision } from '../structuredOutputRetry'

describe('structured output retry decisions', () => {
  it('classifies length-finished responses as output truncation instead of schema validation', () => {
    const decision = getStructuredRetryDecision('schema_version: 1\ntechnical_requirements:\n  performance_constraints:\n    - Configurable max export file', {
      hasAssistantMessage: true,
      latestAssistantWasEmpty: false,
      latestAssistantHasError: false,
      latestAssistantWasStale: false,
      sessionErrored: false,
      latestStepFinishReason: 'length',
    })

    expect(decision).toEqual({
      failureClass: 'output_truncated',
      reuseSession: false,
      useStructuredRetryPrompt: false,
    })
  })
})
