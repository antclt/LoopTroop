import { PROFILE_DEFAULTS } from '../db/defaults'

export const MIN_STRUCTURED_RETRY_COUNT = 0
export const MAX_STRUCTURED_RETRY_COUNT = 5

export function normalizeStructuredRetryCount(
  value: unknown,
  fallback = PROFILE_DEFAULTS.structuredRetryCount,
): number {
  const candidate = typeof value === 'number' && Number.isInteger(value) ? value : fallback
  if (candidate < MIN_STRUCTURED_RETRY_COUNT) return MIN_STRUCTURED_RETRY_COUNT
  if (candidate > MAX_STRUCTURED_RETRY_COUNT) return MAX_STRUCTURED_RETRY_COUNT
  return candidate
}

export function shouldRetryStructuredOutput(
  retryAttemptsUsed: number,
  structuredRetryCount: number,
): boolean {
  return retryAttemptsUsed < normalizeStructuredRetryCount(structuredRetryCount)
}
