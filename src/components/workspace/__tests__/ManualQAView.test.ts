import { describe, expect, it } from 'vitest'
import { buildCanonicalManualQaDraft, buildManualQaImprovementContextPreview, validateManualQaItem } from '@/lib/manualQaDraft'
import type { ManualQaChecklistItem, ManualQaItemResult, ManualQaRound } from '@/hooks/useManualQA'

const item: ManualQaChecklistItem = {
  id: 'v1-item-1',
  lineageId: 'checkout-submit',
  title: 'Submit checkout',
  source: 'prd',
  behavior: 'A valid cart can be submitted.',
  severity: 'required',
  prerequisites: [],
  actions: ['Submit a valid cart.'],
  expectedResult: 'The order is confirmed once.',
  prdRefs: [{ ref: 'epic/story/AC-1', coverage: 'full' }],
}

function result(status: ManualQaItemResult['status'], extra: Partial<ManualQaItemResult> = {}): ManualQaItemResult {
  return { itemId: item.id, status, ...extra }
}

describe('Manual QA result validation', () => {
  it('requires an explicit result for required items', () => {
    expect(validateManualQaItem(item, result('pending'))).toContain('Required checks must be marked Pass, Fail, Waive, or Improvement.')
    expect(validateManualQaItem(item, result('pass'))).toEqual([])
  })

  it('requires observations, waiver reasons, and reviewed improvement drafts', () => {
    expect(validateManualQaItem(item, result('fail'))).toContain('Describe what you observed for this failure.')
    expect(validateManualQaItem(item, result('waive'))).toContain('Explain why this check is being waived.')
    expect(validateManualQaItem({ ...item, severity: 'optional' }, result('improvement'))).toEqual([
      'Improvement title is required.',
      'Improvement description is required.',
    ])
    expect(validateManualQaItem(item, result('improvement', {
      improvement: { title: 'Clarify confirmation', description: 'Use a clearer message.' },
    }))).toEqual([])
  })

  it('builds the strict submission draft without changing the autosave shape', () => {
    const round: ManualQaRound = {
      version: 2,
      status: 'waiting',
      checklistHash: 'a'.repeat(64),
      checklist: { schemaVersion: 1, version: 2, items: [item] },
      coverage: [],
      coverageSummary: { coveredCount: 0, partiallyCoveredCount: 0, uncoveredCount: 0, sourceItemCounts: { prd: 0, bead: 0, previousQa: 0, implementationDiff: 0 } },
      evidence: [],
      draftRevision: 4,
    }
    const uiDraft = {
      results: {
        [item.id]: result('fail', { observation: 'The button stayed disabled.', mergeGroup: 'checkout failures' }),
      },
    }

    const canonical = buildCanonicalManualQaDraft('ticket-1', round, uiDraft, 5)
    expect(canonical).toMatchObject({
      schemaVersion: 1,
      artifact: 'manual_qa_draft',
      ticketId: 'ticket-1',
      version: 2,
      draftRevision: 5,
      results: [{
        itemId: item.id,
        outcome: 'fail',
        observation: 'The button stayed disabled.',
        mergeGroupId: 'qa-merge-checkout-failures',
      }],
    })
    expect(uiDraft.results[item.id]).not.toHaveProperty('outcome')
  })

  it('previews the human-readable context that future planning receives', () => {
    const preview = buildManualQaImprovementContextPreview(
      { ...item, severity: 'optional' },
      result('improvement', {
        note: 'The confirmation could be clearer.',
        evidenceIds: ['evidence-1'],
        links: [{ id: 'link-1', url: 'https://example.com/notes', label: 'Research notes' }],
        improvement: { title: 'Clarify confirmation', description: 'Use a more explicit confirmation message.' },
      }),
    )

    expect(preview).toContain('## Manual QA Context')
    expect(preview).toContain('### User Note\nThe confirmation could be clearer.')
    expect(preview).toContain('### Improvement Request\nClarify confirmation\nExpected result: The order is confirmed once.')
    expect(preview).toContain('- PRD requirement: A valid cart can be submitted.')
    expect(preview).toContain('- Evidence summary: 1 uploaded evidence file retained with the Manual QA origin metadata.')
    expect(preview).toContain('- Research notes: https://example.com/notes')
    expect(preview).not.toContain('evidence-1')
  })

  it('preserves user-edited Manual QA context in the canonical improvement draft', () => {
    const round: ManualQaRound = {
      version: 3,
      status: 'waiting',
      checklistHash: 'c'.repeat(64),
      checklist: { schemaVersion: 1, version: 3, items: [item] },
      coverage: [],
      coverageSummary: { coveredCount: 0, partiallyCoveredCount: 0, uncoveredCount: 0, sourceItemCounts: { prd: 0, bead: 0, previousQa: 0, implementationDiff: 0 } },
      evidence: [],
      draftRevision: 1,
    }
    const contextOverride = '## Manual QA Context\nEdited context retained for future implementation.'
    const improvementResult = result('improvement', {
      improvement: { title: 'Clarify confirmation', description: 'Use a clearer message.', contextOverride },
    })

    expect(validateManualQaItem(item, improvementResult)).toEqual([])
    expect(buildManualQaImprovementContextPreview(item, improvementResult)).toContain(contextOverride)
    expect(buildCanonicalManualQaDraft('ticket-1', round, {
      results: { [item.id]: improvementResult },
    }, 2).improvements[0]).toMatchObject({ contextOverride })
  })
})
