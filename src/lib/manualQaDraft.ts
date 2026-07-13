import type {
  ManualQaChecklistItem,
  ManualQaDraft,
  ManualQaItemResult,
  ManualQaRound,
} from '@/hooks/useManualQA'
import {
  buildManualQaImprovementContext,
  composeManualQaImprovementDescription,
  createManualQaImprovementDraftId,
} from '@shared/manualQaImprovement'

function resultFor(draft: ManualQaDraft, itemId: string): ManualQaItemResult {
  return draft.results[itemId] ?? { itemId, status: 'pending', evidenceIds: [] }
}

export function validateManualQaItem(item: ManualQaChecklistItem, result: ManualQaItemResult): string[] {
  const errors: string[] = []
  if (item.severity === 'required' && result.status === 'pending') {
    errors.push('Required checks must be marked Pass, Fail, Waive, or Improvement.')
  }
  if (result.status === 'fail' && !result.observation?.trim()) errors.push('Describe what you observed for this failure.')
  if (result.status === 'waive' && !result.waiverReason?.trim()) errors.push('Explain why this check is being waived.')
  if (result.status === 'improvement') {
    if (!result.improvement?.title.trim()) errors.push('Improvement title is required.')
    if (!result.improvement?.description.trim()) errors.push('Improvement description is required.')
    if (result.improvement?.contextOverride !== undefined && !result.improvement.contextOverride.trim()) {
      errors.push('Manual QA context cannot be empty.')
    }
    if ((result.improvement?.contextOverride?.trim().length ?? 0) > 10_000) {
      errors.push('Manual QA context must be 10,000 characters or fewer.')
    }
  }
  return errors
}

function canonicalId(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || 'item').slice(0, 120)
}

export function buildCanonicalManualQaDraft(
  ticketId: string,
  round: ManualQaRound,
  uiDraft: ManualQaDraft,
  draftRevision: number,
) {
  const improvements: Array<{
    id: string
    itemId: string
    title: string
    description: string
    contextOverride?: string
    evidenceIds: string[]
  }> = []
  const results = (round.checklist?.items ?? []).map((item) => {
    const result = resultFor(uiDraft, item.id)
    const improvementId = result.status === 'improvement'
      ? createManualQaImprovementDraftId(round.version, item.id)
      : undefined
    if (improvementId && result.improvement) {
      improvements.push({
        id: improvementId,
        itemId: item.id,
        title: result.improvement.title.trim(),
        description: result.improvement.description.trim(),
        ...(result.improvement.contextOverride !== undefined
          ? { contextOverride: result.improvement.contextOverride.trim() }
          : {}),
        evidenceIds: result.improvement.evidenceIds ?? result.evidenceIds ?? [],
      })
    }
    return {
      itemId: item.id,
      outcome: result.status,
      note: result.note ?? '',
      observation: result.observation ?? '',
      reason: result.waiverReason ?? '',
      evidenceIds: result.evidenceIds ?? [],
      links: result.links ?? [],
      ...(improvementId ? { improvementDraftId: improvementId } : {}),
      ...(result.mergeGroup?.trim() ? { mergeGroupId: `qa-merge-${canonicalId(result.mergeGroup.trim())}` } : {}),
    }
  })
  return {
    schemaVersion: 1,
    artifact: 'manual_qa_draft',
    ticketId,
    version: round.version,
    checklistHash: round.checklistHash,
    draftRevision,
    results,
    improvements,
    evidence: round.evidence.map((file) => ({
      id: file.id,
      itemId: file.itemId,
      originalName: file.originalName ?? file.name,
      storedName: file.storedName ?? file.name,
      mediaType: file.mediaType,
      size: file.size,
      sha256: file.sha256,
      inlinePreview: file.inlinePreview ?? file.previewable,
      createdAt: file.createdAt ?? new Date(0).toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  }
}

export function buildManualQaImprovementContextPreview(
  item: ManualQaChecklistItem,
  result: ManualQaItemResult,
): string {
  return composeManualQaImprovementPreview(item, result).description
}

function improvementDescriptionInput(item: ManualQaChecklistItem, result: ManualQaItemResult) {
  const improvement = result.improvement
  return {
    description: improvement?.description.trim() ?? '',
    itemTitle: item.title?.trim() || item.behavior,
    behavior: item.behavior,
    source: item.source,
    expectedResult: item.expectedResult,
    actions: item.actions,
    userNote: result.note,
    improvementTitle: improvement?.title.trim(),
    observation: result.observation,
    links: result.links,
    evidenceCount: result.evidenceIds?.length ?? 0,
    hasPrdRefs: item.prdRefs.length > 0,
    hasBeadRefs: (item.beadRefs?.length ?? 0) > 0,
    contextOverride: improvement?.contextOverride,
  }
}

export function buildDefaultManualQaImprovementContext(
  item: ManualQaChecklistItem,
  result: ManualQaItemResult,
): string {
  return buildManualQaImprovementContext(improvementDescriptionInput(item, result))
}

export function composeManualQaImprovementPreview(
  item: ManualQaChecklistItem,
  result: ManualQaItemResult,
) {
  return composeManualQaImprovementDescription(improvementDescriptionInput(item, result))
}
