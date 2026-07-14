import { describe, expect, it } from 'vitest'
import {
  buildCanonicalManualQaDraft,
  buildManualQaImprovementContextPreview,
  validateManualQaItem,
  validateManualQaMergeGroups,
} from '@/lib/manualQaDraft'
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

  it('requires failure observations and reviewed improvement drafts while keeping waiver reasons optional', () => {
    expect(validateManualQaItem(item, result('fail'))).toContain('Describe what you observed for this failure.')
    expect(validateManualQaItem(item, result('waive'))).toEqual([])
    expect(validateManualQaItem(item, result('waive', { waiverReason: 'Accepted for this delivery.' }))).toEqual([])
    expect(validateManualQaItem({ ...item, severity: 'optional' }, result('improvement'))).toEqual([
      'Improvement title is required.',
      'Improvement description is required.',
    ])
    expect(validateManualQaItem(item, result('improvement', {
      improvement: { title: 'Clarify confirmation', description: 'Use a clearer message.', priority: 3, manualQaEnabled: true },
    }))).toEqual([])
  })

  it('builds connected merge groups without changing the autosave shape', () => {
    const paymentItem: ManualQaChecklistItem = {
      ...item,
      id: 'v1-item-2',
      lineageId: 'payment-confirmation',
      title: 'Confirm payment',
    }
    const receiptItem: ManualQaChecklistItem = {
      ...item,
      id: 'v1-item-3',
      lineageId: 'receipt-delivery',
      title: 'Deliver receipt',
    }
    const unrelatedItem: ManualQaChecklistItem = {
      ...item,
      id: 'v1-item-4',
      lineageId: 'account-history',
      title: 'Show account history',
    }
    const round: ManualQaRound = {
      version: 2,
      status: 'waiting',
      checklistHash: 'a'.repeat(64),
      checklist: { schemaVersion: 1, version: 2, items: [item, paymentItem, receiptItem, unrelatedItem] },
      coverage: [],
      coverageSummary: { coveredCount: 0, partiallyCoveredCount: 0, uncoveredCount: 0, notApplicableCount: 0, sourceItemCounts: { prd: 0, bead: 0, previousQa: 0, implementationDiff: 0 } },
      evidence: [],
      draftRevision: 4,
    }
    const uiDraft = {
      results: {
        [item.id]: result('fail', {
          observation: 'The button stayed disabled.',
          mergeWithItemIds: [paymentItem.id],
        }),
        [paymentItem.id]: { ...result('fail', { observation: 'Payment did not complete.' }), itemId: paymentItem.id, mergeWithItemIds: [receiptItem.id] },
        [receiptItem.id]: { ...result('fail', { observation: 'No receipt arrived.' }), itemId: receiptItem.id },
        [unrelatedItem.id]: { ...result('pass'), itemId: unrelatedItem.id },
      },
    }

    const canonical = buildCanonicalManualQaDraft('ticket-1', round, uiDraft, 5)
    expect(canonical).toMatchObject({
      schemaVersion: 1,
      artifact: 'manual_qa_draft',
      ticketId: 'ticket-1',
      version: 2,
      draftRevision: 5,
    })
    const checkout = canonical.results[0]!
    const payment = canonical.results[1]!
    const receipt = canonical.results[2]!
    const unrelated = canonical.results[3]!
    expect(checkout).toMatchObject({ itemId: item.id, outcome: 'fail', observation: 'The button stayed disabled.' })
    expect(checkout.mergeGroupId).toMatch(/^qa-merge-[0-9a-f]{8}$/)
    expect(payment.mergeGroupId).toBe(checkout.mergeGroupId)
    expect(receipt.mergeGroupId).toBe(checkout.mergeGroupId)
    expect(unrelated).not.toHaveProperty('mergeGroupId')
    expect(uiDraft.results[item.id]).not.toHaveProperty('outcome')
    expect(uiDraft.results[item.id]).not.toHaveProperty('mergeGroupId')
  })

  it('names every selected non-failed item by checklist number and title', () => {
    const secondItem: ManualQaChecklistItem = {
      ...item,
      id: 'v1-item-2',
      lineageId: 'payment-confirmation',
      title: 'Confirm payment',
    }
    const thirdItem: ManualQaChecklistItem = {
      ...item,
      id: 'v1-item-3',
      lineageId: 'receipt-delivery',
      title: 'Deliver receipt',
    }
    const draft = {
      results: {
        [item.id]: result('fail', {
          observation: 'The button stayed disabled.',
          mergeWithItemIds: [secondItem.id, thirdItem.id],
        }),
        [secondItem.id]: { ...result('pass'), itemId: secondItem.id },
        [thirdItem.id]: { ...result('pending'), itemId: thirdItem.id },
      },
    }

    expect(validateManualQaMergeGroups([item, secondItem, thirdItem], draft)).toEqual([
      'Item 1 Submit checkout has item 2 Confirm payment and item 3 Deliver receipt in its merge group, but those items were not marked as Fail.',
    ])
  })

  it('previews the human-readable context that future planning receives', () => {
    const preview = buildManualQaImprovementContextPreview(
      { ...item, severity: 'optional' },
      result('improvement', {
        note: 'The confirmation could be clearer.',
        evidenceIds: ['evidence-1'],
        links: [{ id: 'link-1', url: 'https://example.com/notes', label: 'Research notes' }],
        improvement: { title: 'Clarify confirmation', description: 'Use a more explicit confirmation message.', priority: 3, manualQaEnabled: true },
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
      coverageSummary: { coveredCount: 0, partiallyCoveredCount: 0, uncoveredCount: 0, notApplicableCount: 0, sourceItemCounts: { prd: 0, bead: 0, previousQa: 0, implementationDiff: 0 } },
      evidence: [],
      draftRevision: 1,
    }
    const contextOverride = '## Manual QA Context\nEdited context retained for future implementation.'
    const improvementResult = result('improvement', {
      improvement: { title: 'Clarify confirmation', description: 'Use a clearer message.', priority: 2, manualQaEnabled: false, contextOverride },
    })

    expect(validateManualQaItem(item, improvementResult)).toEqual([])
    expect(buildManualQaImprovementContextPreview(item, improvementResult)).toContain(contextOverride)
    expect(buildCanonicalManualQaDraft('ticket-1', round, {
      results: { [item.id]: improvementResult },
    }, 2).improvements[0]).toMatchObject({ contextOverride, priority: 2, manualQaEnabled: false })
  })
})
