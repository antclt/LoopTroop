import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/context/LogContext'
import { filterEntries } from '../logFormat'

function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'provider-error',
    entryId: 'provider-error',
    line: 'Your authentication token has been invalidated. Please try signing in again. (HTTP 401, requestModel=gpt-5.3-codex)',
    source: 'model:openai/gpt-5.3-codex',
    status: 'PRE_FLIGHT_CHECK',
    timestamp: '2026-04-29T15:25:08.000Z',
    audience: 'ai',
    kind: 'error',
    modelId: 'openai/gpt-5.3-codex',
    sessionId: 'ses-probe',
    streaming: false,
    op: 'append',
    ...overrides,
  }
}

describe('logFormat filtering', () => {
  it('shows provider API errors in ALL and ERROR tabs', () => {
    const providerError = makeLog()

    expect(filterEntries([providerError], 'ALL')).toContain(providerError)
    expect(filterEntries([providerError], 'ERROR')).toContain(providerError)
  })

  it('does not classify raw AI text as SYS, ERROR, or CMD when it mentions log tags', () => {
    const rawModelOutput = makeLog({
      id: 'raw-model-output',
      entryId: 'raw-model-output',
      line: [
        '[MODEL] Review result:',
        '[ERROR] is an example string in the model response.',
        '[SYS] is also only response text.',
        '[CMD] $ npm test is recommended later.',
      ].join('\n'),
      kind: 'text',
    })

    expect(filterEntries([rawModelOutput], 'ERROR')).not.toContain(rawModelOutput)
    expect(filterEntries([rawModelOutput], 'SYS')).not.toContain(rawModelOutput)
    expect(filterEntries([rawModelOutput], 'CMD')).not.toContain(rawModelOutput)
    expect(filterEntries([rawModelOutput], 'ALL')).toContain(rawModelOutput)
  })

  it('does not classify leading ERROR text from a normal model response as an error row', () => {
    const rawModelOutput = makeLog({
      id: 'raw-leading-error-output',
      entryId: 'raw-leading-error-output',
      line: '[ERROR] This is quoted model output, not a runtime failure.',
      kind: 'text',
    })

    expect(filterEntries([rawModelOutput], 'ERROR')).not.toContain(rawModelOutput)
    expect(filterEntries([rawModelOutput], 'ALL')).toContain(rawModelOutput)
  })

  it('keeps AI error rows visible in ERROR', () => {
    const aiError = makeLog({
      id: 'ai-error',
      entryId: 'ai-error',
      line: '[ERROR] Session retry failed.',
      kind: 'error',
    })

    expect(filterEntries([aiError], 'ERROR')).toContain(aiError)
  })

  it('keeps model-attributed system milestones in SYS and the matching model tab', () => {
    const systemMilestone = makeLog({
      id: 'coverage-system',
      entryId: 'coverage-system',
      line: '[SYS] Coverage verification passed for PRD Candidate v2.',
      source: 'system',
      audience: 'all',
      kind: 'milestone',
      modelId: 'openai/gpt-5.4',
      sessionId: undefined,
    })

    expect(filterEntries([systemMilestone], 'SYS')).toContain(systemMilestone)
    expect(filterEntries([systemMilestone], 'openai/gpt-5.4')).toContain(systemMilestone)
  })

  it('keeps legacy-shaped AI detail rows out of SYS when model identity remains', () => {
    const legacyAiDetail = makeLog({
      id: 'legacy-ai-detail',
      entryId: 'legacy-ai-detail',
      line: '[SYS] This was model output cached with old system defaults.',
      source: 'system',
      audience: 'all',
      kind: 'text',
      modelId: 'openai/gpt-5.4',
      sessionId: 'session-1',
    })

    expect(filterEntries([legacyAiDetail], 'SYS')).not.toContain(legacyAiDetail)
    expect(filterEntries([legacyAiDetail], 'openai/gpt-5.4')).toContain(legacyAiDetail)
  })
})
