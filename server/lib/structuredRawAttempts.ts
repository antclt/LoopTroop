import type { RawAttempt, RawAttemptStage } from '../council/types'
import type { StructuredFailureClass } from './structuredOutputRetry'

interface RawAttemptInput {
  stage: RawAttemptStage
  rawResponse?: string
  initialInput?: string
}

interface RejectedRawAttemptInput extends RawAttemptInput {
  validationError?: string
  failureClass?: StructuredFailureClass
}

function nextAttemptNumber(rawAttempts: readonly RawAttempt[]): number {
  return rawAttempts.length + 1
}

function getInitialInputForAttempt(rawAttempts: readonly RawAttempt[], input: RawAttemptInput): string | undefined {
  if (rawAttempts.length > 0) return undefined
  if (typeof input.initialInput !== 'string' || input.initialInput.length === 0) return undefined
  return input.initialInput
}

export function appendAcceptedRawAttempt(
  rawAttempts: RawAttempt[],
  input: RawAttemptInput,
): RawAttempt {
  const initialInput = getInitialInputForAttempt(rawAttempts, input)
  const attempt: RawAttempt = {
    attempt: nextAttemptNumber(rawAttempts),
    stage: input.stage,
    outcome: 'accepted',
    rawResponse: input.rawResponse ?? '',
    ...(initialInput ? { initialInput } : {}),
  }
  rawAttempts.push(attempt)
  return attempt
}

export function appendRejectedRawAttempt(
  rawAttempts: RawAttempt[],
  input: RejectedRawAttemptInput,
): RawAttempt {
  const initialInput = getInitialInputForAttempt(rawAttempts, input)
  const attempt: RawAttempt = {
    attempt: nextAttemptNumber(rawAttempts),
    stage: input.stage,
    outcome: 'rejected',
    rawResponse: input.rawResponse ?? '',
    ...(initialInput ? { initialInput } : {}),
    ...(input.validationError ? { validationError: input.validationError } : {}),
    ...(input.failureClass ? { failureClass: input.failureClass } : {}),
  }
  rawAttempts.push(attempt)
  return attempt
}
