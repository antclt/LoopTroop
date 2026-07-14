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
not_applicable_prd_refs: []
items:
  - lineage_id: save-form
    prior_item_ids: []
    title: Save valid form values
    source: prd
    behavior: Saving a valid form persists the values
    severity: required
    recheck_state: new
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
    title: Show actionable validation errors
    source: implementation_diff
    behavior: Invalid values show an actionable error
    severity: optional
    recheck_state: new
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
    expect(coverage.sourceItemCounts).toEqual({
      prd: 1,
      bead: 0,
      previousQa: 0,
      implementationDiff: 1,
    })
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

  it('classifies criteria that are not applicable to human Manual QA with a required reason', () => {
    const notApplicable = output().replace(
      'not_applicable_prd_refs: []',
      [
        'not_applicable_prd_refs:',
        '  - ref: EPIC-1/US-1/AC-3',
        '    reason: This internal invariant is fully exercised by automated tests and has no user-observable behavior.',
      ].join('\n'),
    )
    const result = parseManualQaChecklistOutput(notApplicable, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(computeManualQaCoverage(result.value, criteria)).toMatchObject({
      notApplicableCount: 1,
      uncoveredCount: 0,
      entries: expect.arrayContaining([{
        criterionRef: 'EPIC-1/US-1/AC-3',
        criterion: 'Keyboard remains usable',
        status: 'not_applicable',
        itemIds: [],
        reason: 'This internal invariant is fully exercised by automated tests and has no user-observable behavior.',
      }]),
    })
  })

  it('rejects duplicate not-applicable PRD references', () => {
    const duplicate = output().replace(
      'not_applicable_prd_refs: []',
      [
        'not_applicable_prd_refs:',
        '  - ref: EPIC-1/US-1/AC-1',
        '    reason: Automated only.',
        '  - ref: EPIC-1/US-1/AC-1',
        '    reason: Internal only.',
      ].join('\n'),
    )
    const result = parseManualQaChecklistOutput(duplicate, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Duplicate not-applicable')
  })

  it('rejects PRD criteria that are both checklist-covered and not applicable', () => {
    const overlapping = output().replace(
      'not_applicable_prd_refs: []',
      [
        'not_applicable_prd_refs:',
        '  - ref: EPIC-1/US-1/AC-1',
        '    reason: Automated only.',
      ].join('\n'),
    )
    const result = parseManualQaChecklistOutput(overlapping, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('both checklist-covered and not applicable')
  })

  it('preserves unquoted hex colors in known Manual QA prose fields', () => {
    const withHexColor = output().replace(
      'Enter valid values and choose Save',
      'Observe the saved border (expect #ff69b4)',
    )
    const result = parseManualQaChecklistOutput(withHexColor, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items[0]?.actions).toContain('Observe the saved border (expect #ff69b4)')
    expect(result.repairWarnings).toContain('Quoted hex-color text in Manual QA prose before YAML parsing.')
  })

  it('rejects the superseded source, severity, required, and recheck fields', () => {
    const legacy = output()
      .replace('source: implementation_diff', 'source: implementation')
      .replace('severity: required', 'severity: high\n    required: true')
      .replace('recheck_state: new', 'recheck_state: pending')
    const result = parseManualQaChecklistOutput(legacy, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })

    expect(result.ok).toBe(false)
  })

  it('requires exactly one complete tagged response', () => {
    const result = parseManualQaChecklistOutput(`prefix\n${output()}\n${output()}`, {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })
    expect(result.ok).toBe(false)
  })

  it('requires failed prior items to retain stable lineage and become pending rechecks', () => {
    const priorResult = parseManualQaChecklistOutput(output(), {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
      generatedAt: '2026-07-13T00:00:00.000Z',
    })
    expect(priorResult.ok).toBe(true)
    if (!priorResult.ok) return
    const nextOutput = output()
      .replace('prior_item_ids: []', 'prior_item_ids: [qa-v1-001]')
      .replace('recheck_state: new', 'recheck_state: pending_recheck')
    const nextResult = parseManualQaChecklistOutput(nextOutput, {
      ticketId: 'DEMO-1',
      version: 2,
      prdCriteria: criteria,
      previousChecklist: priorResult.value,
      previousResults: {
        schemaVersion: 1,
        artifact: 'manual_qa_results',
        ticketId: 'DEMO-1',
        version: 1,
        checklistHash: 'a'.repeat(64),
        draftRevision: 1,
        results: [{
          itemId: 'qa-v1-001',
          outcome: 'fail',
          note: '',
          observation: 'Values disappeared',
          reason: '',
          evidenceIds: [],
          links: [],
        }],
        improvements: [],
        evidence: [],
        updatedAt: '2026-07-13T00:00:00.000Z',
        actionId: 'submit-one',
        submittedAt: '2026-07-13T00:01:00.000Z',
      },
    })
    expect(nextResult.ok).toBe(true)
  })

  it('rejects changed lineage and dropped failed items on later rounds', () => {
    const priorResult = parseManualQaChecklistOutput(output(), {
      ticketId: 'DEMO-1',
      version: 1,
      prdCriteria: criteria,
    })
    expect(priorResult.ok).toBe(true)
    if (!priorResult.ok) return
    const nextResult = parseManualQaChecklistOutput(output(), {
      ticketId: 'DEMO-1',
      version: 2,
      prdCriteria: criteria,
      previousChecklist: priorResult.value,
      previousResults: {
        schemaVersion: 1,
        artifact: 'manual_qa_results',
        ticketId: 'DEMO-1',
        version: 1,
        checklistHash: 'a'.repeat(64),
        draftRevision: 1,
        results: [{
          itemId: 'qa-v1-001', outcome: 'fail', note: '', observation: 'Still broken', reason: '', evidenceIds: [], links: [],
        }],
        improvements: [], evidence: [], updatedAt: new Date().toISOString(), actionId: 'submit-one', submittedAt: new Date().toISOString(),
      },
    })
    expect(nextResult.ok).toBe(false)
    if (nextResult.ok) return
    expect(nextResult.error).toContain('Previously failed item qa-v1-001 must remain')
  })
})
