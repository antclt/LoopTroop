import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/context/LogContext'
import { deriveCurrentActivity, formatElapsedDuration } from '../currentActivity'

const BASE_TIME_MS = Date.parse('2026-05-25T10:00:00.000Z')

function timestamp(offsetMs: number): string {
  return new Date(BASE_TIME_MS + offsetMs).toISOString()
}

function makeLog(id: string, line: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    entryId: id,
    line,
    source: 'system',
    status: 'CODING',
    timestamp: timestamp(0),
    audience: 'all',
    kind: 'milestone',
    streaming: false,
    op: 'append',
    ...overrides,
  }
}

function makePrompt(overrides: Partial<LogEntry> = {}): LogEntry {
  return makeLog('prompt-1', '[PROMPT] openai/gpt-5-codex prompt #1\nImplement bead 2.', {
    source: 'model:openai/gpt-5-codex',
    audience: 'ai',
    kind: 'prompt',
    modelId: 'openai/gpt-5-codex',
    sessionId: 'ses_waiting',
    beadId: 'bead-2',
    ...overrides,
  })
}

describe('deriveCurrentActivity', () => {
  it('shows waiting elapsed time after a prompt with no later activity', () => {
    const activity = deriveCurrentActivity([makePrompt()], BASE_TIME_MS + 72_000)

    expect(activity?.kind).toBe('waiting_first_model_activity')
    expect(activity?.label).toBe('Waiting for first model activity')
    expect(activity?.elapsedMs).toBe(72_000)
    expect(formatElapsedDuration(activity?.elapsedMs ?? 0)).toBe('1m 12s')
    expect(activity?.sessionId).toBe('ses_waiting')
    expect(activity?.beadId).toBe('bead-2')
  })

  it('treats a continue please prompt as a normal model dispatch', () => {
    const activity = deriveCurrentActivity([
      makePrompt({
        id: 'continue-prompt',
        entryId: 'continue-prompt',
        line: '[PROMPT] openai/gpt-5-codex prompt #2\ncontinue please',
        sessionId: 'ses_continue',
      }),
    ], BASE_TIME_MS + 5_000)

    expect(activity?.kind).toBe('waiting_first_model_activity')
    expect(activity?.sessionId).toBe('ses_continue')
  })

  it('clears waiting after the first model activity milestone', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('first-activity', 'First AI activity observed from openai/gpt-5-codex (session=ses_waiting).', {
        timestamp: timestamp(2_000),
        source: 'model:openai/gpt-5-codex',
        modelId: 'openai/gpt-5-codex',
        sessionId: 'ses_waiting',
      }),
    ], BASE_TIME_MS + 10_000)

    expect(activity).toBeNull()
  })

  it('shows provider retrying after a session retry before first activity', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('retry-1', 'Session retry #1: The usage limit has been reached. Please try again later.', {
        timestamp: timestamp(3_000),
        source: 'model:openai/gpt-5-codex',
        audience: 'ai',
        kind: 'error',
        modelId: 'openai/gpt-5-codex',
        sessionId: 'ses_waiting',
      }),
    ], BASE_TIME_MS + 8_000)

    expect(activity?.kind).toBe('provider_retrying')
    expect(activity?.label).toBe('Provider retrying before first model activity')
    expect(activity?.active).toBe(true)
  })

  it('shows provider retry timeout when the OpenCode retry budget expires', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('retry-timeout', '[ERROR] OpenCode retry grace window expired after 60000ms (retry attempt 2): usage limit.', {
        timestamp: timestamp(60_000),
        source: 'error',
        kind: 'error',
      }),
    ], BASE_TIME_MS + 61_000)

    expect(activity?.kind).toBe('provider_retry_timeout')
    expect(activity?.diagnostic).toBe('provider_retry_timeout')
    expect(activity?.active).toBe(false)
  })

  it('classifies explicit OpenCode provider timeout logs as provider_timeout_preserved', () => {
    const activity = deriveCurrentActivity([
      makePrompt({ sessionId: 'ses_continue' }),
      makeLog('provider-timeout', 'OpenCode/provider timeout for session ses_continue; preserving session for Continue.', {
        timestamp: timestamp(60_000),
        source: 'opencode',
        audience: 'debug',
        kind: 'error',
      }),
    ], BASE_TIME_MS + 61_000)

    expect(activity?.kind).toBe('provider_timeout_preserved')
    expect(activity?.diagnostic).toBe('provider_timeout_preserved')
    expect(activity?.sessionId).toBe('ses_continue')
  })

  it('shows empty-output state for responseChars=0', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('empty-output', '[SYS] OpenCode coding_main: openai/gpt-5-codex session=ses_waiting, messages=3, responseChars=0.', {
        timestamp: timestamp(4_000),
        modelId: 'openai/gpt-5-codex',
      }),
    ], BASE_TIME_MS + 5_000)

    expect(activity?.kind).toBe('empty_model_output')
    expect(activity?.label).toBe('Model returned no visible output')
    expect(activity?.diagnostic).toBe('empty_model_output')
  })

  it('classifies timeout before first activity as model_no_activity_timeout', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('timeout', '[ERROR] OpenCode prompt timed out after 120000ms.', {
        timestamp: timestamp(120_000),
        source: 'error',
        kind: 'error',
      }),
    ], BASE_TIME_MS + 121_000)

    expect(activity?.kind).toBe('model_no_activity_timeout')
    expect(activity?.diagnostic).toBe('model_no_activity_timeout')
  })

  it('classifies explicit iteration timeout logs as iteration_timeout', () => {
    const activity = deriveCurrentActivity([
      makePrompt({ sessionId: 'ses_iteration', beadId: 'bead-7' }),
      makeLog('iteration-timeout', 'Iteration timeout for bead bead-7 attempt 1; resetting for attempt 2 of 3.', {
        timestamp: timestamp(120_000),
        source: 'workflow',
        audience: 'debug',
        kind: 'error',
      }),
    ], BASE_TIME_MS + 121_000)

    expect(activity?.kind).toBe('iteration_timeout')
    expect(activity?.diagnostic).toBe('iteration_timeout')
    expect(activity?.beadId).toBe('bead-7')
  })

  it('classifies timeout after first activity as workflow_timeout', () => {
    const activity = deriveCurrentActivity([
      makePrompt(),
      makeLog('model-output', '[MODEL] Starting implementation.', {
        timestamp: timestamp(2_000),
        source: 'model:openai/gpt-5-codex',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-codex',
        sessionId: 'ses_waiting',
      }),
      makeLog('timeout', '[ERROR] Workflow timeout after model activity.', {
        timestamp: timestamp(120_000),
        source: 'error',
        kind: 'error',
      }),
    ], BASE_TIME_MS + 121_000)

    expect(activity?.kind).toBe('workflow_timeout')
    expect(activity?.diagnostic).toBe('workflow_timeout')
  })
})
