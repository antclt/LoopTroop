import type { PrdDocument } from '../../structuredOutput/types'
import type {
  ManualQaChecklist,
  ManualQaCoverage,
  ManualQaPrdCriterion,
} from './types'
import { MANUAL_QA_SCHEMA_VERSION } from './types'

export function deriveManualQaPrdCriteria(
  prd: Pick<PrdDocument, 'epics'>,
): ManualQaPrdCriterion[] {
  return prd.epics.flatMap((epic) => epic.user_stories.flatMap((story) =>
    story.acceptance_criteria.map((criterion, index) => ({
      ref: `${epic.id}/${story.id}/AC-${index + 1}`,
      criterion,
    })),
  ))
}

export function validateManualQaPrdReferences(
  checklist: ManualQaChecklist,
  criteria: readonly ManualQaPrdCriterion[],
): void {
  const validRefs = new Set(criteria.map((entry) => entry.ref))
  const invalidRefs = checklist.items.flatMap((item) =>
    item.prdRefs
      .filter((reference) => !validRefs.has(reference.ref))
      .map((reference) => `${item.id}: ${reference.ref}`),
  )
  if (invalidRefs.length > 0) {
    throw new Error(`Checklist contains invalid PRD criterion references: ${invalidRefs.join(', ')}`)
  }
}

export function computeManualQaCoverage(
  checklist: ManualQaChecklist,
  criteria: readonly ManualQaPrdCriterion[],
): ManualQaCoverage {
  validateManualQaPrdReferences(checklist, criteria)

  const entries = criteria.map((criterion) => {
    const references = checklist.items.flatMap((item) =>
      item.prdRefs
        .filter((reference) => reference.ref === criterion.ref)
        .map((reference) => ({ itemId: item.id, coverage: reference.coverage })),
    )
    const status = references.some((reference) => reference.coverage === 'full')
      ? 'covered' as const
      : references.some((reference) => reference.coverage === 'partial')
        ? 'partially_covered' as const
        : 'uncovered' as const

    return {
      criterionRef: criterion.ref,
      criterion: criterion.criterion,
      status,
      itemIds: [...new Set(references.map((reference) => reference.itemId))],
    }
  })

  return {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    artifact: 'manual_qa_coverage',
    ticketId: checklist.ticketId,
    version: checklist.version,
    entries,
    coveredCount: entries.filter((entry) => entry.status === 'covered').length,
    partiallyCoveredCount: entries.filter((entry) => entry.status === 'partially_covered').length,
    uncoveredCount: entries.filter((entry) => entry.status === 'uncovered').length,
  }
}
