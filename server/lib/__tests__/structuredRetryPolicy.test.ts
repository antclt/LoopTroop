import { describe, expect, it } from 'vitest'
import {
  MAX_STRUCTURED_RETRY_COUNT,
  MIN_STRUCTURED_RETRY_COUNT,
  normalizeStructuredRetryCount,
  shouldRetryStructuredOutput,
} from '../structuredRetryPolicy'

describe('structuredRetryPolicy', () => {
  it('uses the default count when no value is configured', () => {
    expect(normalizeStructuredRetryCount(undefined)).toBe(1)
  })

  it('clamps configured counts to the supported range', () => {
    expect(normalizeStructuredRetryCount(-1)).toBe(MIN_STRUCTURED_RETRY_COUNT)
    expect(normalizeStructuredRetryCount(0)).toBe(0)
    expect(normalizeStructuredRetryCount(5)).toBe(5)
    expect(normalizeStructuredRetryCount(6)).toBe(MAX_STRUCTURED_RETRY_COUNT)
  })

  it('treats the count as retries after the first response', () => {
    expect(shouldRetryStructuredOutput(0, 0)).toBe(false)
    expect(shouldRetryStructuredOutput(0, 1)).toBe(true)
    expect(shouldRetryStructuredOutput(1, 1)).toBe(false)
    expect(shouldRetryStructuredOutput(1, 2)).toBe(true)
  })
})
