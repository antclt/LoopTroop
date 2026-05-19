import type { RawAttempt, RawAttemptStage } from '../council/types'
import type { StructuredFailureClass } from './structuredOutputRetry'

interface RawAttemptInput {
  stage: RawAttemptStage
  rawResponse?: string
}

interface RejectedRawAttemptInput extends RawAttemptInput {
  validationError?: string
  failureClass?: StructuredFailureClass
}

function nextAttemptNumber(rawAttempts: readonly RawAttempt[]): number {
  return rawAttempts.length + 1
}

export function appendAcceptedRawAttempt(
  rawAttempts: RawAttempt[],
  input: RawAttemptInput,
): RawAttempt {
  const attempt: RawAttempt = {
    attempt: nextAttemptNumber(rawAttempts),
    stage: input.stage,
    outcome: 'accepted',
    rawResponse: input.rawResponse ?? '',
  }
  rawAttempts.push(attempt)
  return attempt
}

export function appendRejectedRawAttempt(
  rawAttempts: RawAttempt[],
  input: RejectedRawAttemptInput,
): RawAttempt {
  const attempt: RawAttempt = {
    attempt: nextAttemptNumber(rawAttempts),
    stage: input.stage,
    outcome: 'rejected',
    rawResponse: input.rawResponse ?? '',
    ...(input.validationError ? { validationError: input.validationError } : {}),
    ...(input.failureClass ? { failureClass: input.failureClass } : {}),
  }
  rawAttempts.push(attempt)
  return attempt
}
