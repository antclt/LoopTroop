import { describe, expect, it } from 'vitest'
import { buildFinalTestFileEffectsAudit, type FinalTestDirtyFile } from '../fileEffectsAudit'

function dirtyFile(path: string, overrides: Partial<FinalTestDirtyFile> = {}): FinalTestDirtyFile {
  return {
    path,
    indexStatus: '?',
    worktreeStatus: '?',
    rawStatus: '??',
    untracked: true,
    contentSignature: 'hash',
    ...overrides,
  }
}

describe('buildFinalTestFileEffectsAudit', () => {
  it('passes when final testing produces a declared candidate file', () => {
    const audit = buildFinalTestFileEffectsAudit({
      baselineDirtyFiles: [],
      dirtyFilesAfterTesting: [dirtyFile('tests/final.spec')],
      declaredEffects: [{ path: 'tests/final.spec', intent: 'candidate' }],
      capturedAt: '2026-05-26T00:00:00.000Z',
    })

    expect(audit.status).toBe('passed')
    expect(audit.candidateFiles).toEqual(['tests/final.spec'])
    expect(audit.unclassifiedFiles).toEqual([])
  })

  it('blocks when final testing leaves an undeclared dirty file', () => {
    const audit = buildFinalTestFileEffectsAudit({
      baselineDirtyFiles: [],
      dirtyFilesAfterTesting: [dirtyFile('tmp/output.log')],
      declaredEffects: [],
      capturedAt: '2026-05-26T00:00:00.000Z',
    })

    expect(audit.status).toBe('blocked')
    expect(audit.unclassifiedFiles).toEqual(['tmp/output.log'])
    expect(audit.decisionRequiredFiles).toEqual(['tmp/output.log'])
  })

  it('ignores files that were already dirty and unchanged before final testing', () => {
    const baseline = dirtyFile('README.md', {
      indexStatus: ' ',
      worktreeStatus: 'M',
      rawStatus: ' M',
      untracked: false,
      contentSignature: 'before',
    })

    const audit = buildFinalTestFileEffectsAudit({
      baselineDirtyFiles: [baseline],
      dirtyFilesAfterTesting: [baseline],
      declaredEffects: [],
      capturedAt: '2026-05-26T00:00:00.000Z',
    })

    expect(audit.status).toBe('passed')
    expect(audit.producedByFinalTesting).toEqual([])
  })
})
