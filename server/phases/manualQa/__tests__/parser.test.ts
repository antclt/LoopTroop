import { describe, expect, it } from 'vitest'
import { computeManualQaCoverage } from '../coverage'
import { parseManualQaChecklistOutput } from '../parser'

const criteria = [
  { ref: 'EPIC-1/US-1/AC-1', criterion: 'User can save the form' },
  { ref: 'EPIC-1/US-1/AC-2', criterion: 'Error is visible' },
  { ref: 'EPIC-1/US-1/AC-3', criterion: 'Keyboard remains usable' },
]

function output(ref = criteria[0]!.ref) {
  return `<MANUAL_QA_CHECKLIST>
summary: Verify the saved form behavior
items:
  - lineage_id: save-form
    prior_item_ids: []
    source: prd
    behavior: Saving a valid form persists the values
    severity: high
    required: true
    recheck_state: pending
    prerequisites:
      - Open the form
    actions:
      - Enter valid values and choose Save
    expected_result: The values remain after reload
    watch_notes: []
    bead_refs: []
    prd_refs:
      - ref: ${ref}
        coverage: full
  - lineage_id: form-errors
    source: implementation
    behavior: Invalid values show an actionable error
    severity: medium
    required: false
    recheck_state: pending
    prerequisites: []
    actions: [Submit an invalid value]
    expected_result: An error is shown without losing the value
    watch_notes: []
    bead_refs: []
    prd_refs:
      - ref: EPIC-1/US-1/AC-2
        coverage: partial
</MANUAL_QA_CHECKLIST>`
}

describe('Manual QA checklist parser and coverage', () => {
  it('normalizes formatting aliases without inventing checklist content', () => {
    const result = parseManualQaChecklistOutput(output(), {
      ticketId: 'DEMO-1',
      version: 2,
      prdCriteria: criteria,
      generatedAt: '2026-07-13T00:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.map((item) => item.id)).toEqual(['qa-v2-001', 'qa-v2-002'])
    expect(result.value.items[0]?.lineageId).toBe('save-form')
    expect(result.repairApplied).toBe(true)
    expect(result.checklistHash).toMatch(/^[a-f0-9]{64}$/)

    const coverage = computeManualQaCoverage(result.value, criteria)
    expect(coverage.entries.map((entry) => entry.status)).toEqual([
      'covered',
      'partially_covered',
      'uncovered',
    ])
  })

  it('rejects invalid PRD references so structured retry can correct them', () => {
    const result = parseManualQaChecklistOutput(output('EPIC-1/US-1/AC-99'), {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('invalid PRD criterion references')
  })

  it('requires exactly one complete tagged response', () => {
    const result = parseManualQaChecklistOutput(`prefix\n${output()}\n${output()}`, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })
    expect(result.ok).toBe(false)
  })
})
