import { describe, expect, it } from 'vitest'
import { buildCanonicalManualQaDraft, validateManualQaItem } from '@/lib/manualQaDraft'
import type { ManualQaChecklistItem, ManualQaItemResult, ManualQaRound } from '@/hooks/useManualQA'

const item: ManualQaChecklistItem = {
  id: 'v1-item-1',
  lineageId: 'checkout-submit',
  title: 'Submit checkout',
  required: true,
  source: 'prd',
  behavior: 'A valid cart can be submitted.',
  severity: 'high',
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
    expect(validateManualQaItem(item, result('pending'))).toContain('Required checks must be marked Pass, Fail, or Waive.')
    expect(validateManualQaItem(item, result('pass'))).toEqual([])
  })

  it('requires observations, waiver reasons, and reviewed improvement drafts', () => {
    expect(validateManualQaItem(item, result('fail'))).toContain('Describe what you observed for this failure.')
    expect(validateManualQaItem(item, result('waive'))).toContain('Explain why this check is being waived.')
    expect(validateManualQaItem({ ...item, required: false }, result('improvement'))).toEqual([
      'Improvement title is required.',
      'Improvement description is required.',
    ])
  })

  it('builds the strict submission draft without changing the autosave shape', () => {
    const round: ManualQaRound = {
      version: 2,
      status: 'waiting',
      checklistHash: 'a'.repeat(64),
      checklist: { schemaVersion: 1, version: 2, items: [item] },
      coverage: [],
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
})
