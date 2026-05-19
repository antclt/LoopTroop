import { describe, expect, it } from 'vitest'
import { appendAcceptedRawAttempt, appendRejectedRawAttempt } from '../structuredRawAttempts'
import type { RawAttempt } from '../../council/types'

describe.concurrent('structured raw attempts', () => {
  it('appends rejected and accepted attempts with sequential attempt numbers', () => {
    const rawAttempts: RawAttempt[] = []

    const rejected = appendRejectedRawAttempt(rawAttempts, {
      stage: 'relevant_files_scan',
      rawResponse: 'not structured',
      validationError: 'Missing files list.',
      failureClass: 'validation_error',
    })
    const accepted = appendAcceptedRawAttempt(rawAttempts, {
      stage: 'relevant_files_scan',
      rawResponse: '<RELEVANT_FILES_RESULT>files: []</RELEVANT_FILES_RESULT>',
    })

    expect(rejected).toEqual({
      attempt: 1,
      stage: 'relevant_files_scan',
      outcome: 'rejected',
      rawResponse: 'not structured',
      validationError: 'Missing files list.',
      failureClass: 'validation_error',
    })
    expect(accepted).toEqual({
      attempt: 2,
      stage: 'relevant_files_scan',
      outcome: 'accepted',
      rawResponse: '<RELEVANT_FILES_RESULT>files: []</RELEVANT_FILES_RESULT>',
    })
    expect(rawAttempts).toEqual([rejected, accepted])
  })

  it('keeps diagnostic-only attempts explicit without inventing model text', () => {
    const rawAttempts: RawAttempt[] = []

    appendRejectedRawAttempt(rawAttempts, {
      stage: 'execution_setup',
      validationError: 'Provider connection reset.',
      failureClass: 'connection_reset',
    })

    expect(rawAttempts).toEqual([
      {
        attempt: 1,
        stage: 'execution_setup',
        outcome: 'rejected',
        rawResponse: '',
        validationError: 'Provider connection reset.',
        failureClass: 'connection_reset',
      },
    ])
  })
})
