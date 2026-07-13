export interface ManualQaImprovementDescriptionInput {
  description: string
  itemTitle: string
  behavior: string
  source?: string
  expectedResult: string
  actions?: string[]
  userNote?: string
  improvementTitle?: string
  observation?: string
  links?: Array<{ url: string; label?: string }>
  evidenceCount?: number
  evidenceSummary?: string
  prdRequirements?: string[]
  beadWorkAreas?: string[]
  contextOverride?: string
  hasPrdRefs?: boolean
  hasBeadRefs?: boolean
}

export interface ManualQaImprovementDescriptionResult {
  description: string
  context: string
  requestedLength: number
  omittedCharacters: number
  omittedFields: string[]
}

export function buildManualQaImprovementContext(input: ManualQaImprovementDescriptionInput): string {
  const prdRequirements = input.prdRequirements?.length
    ? input.prdRequirements
    : input.hasPrdRefs ? [input.behavior] : []
  const beadWorkAreas = input.beadWorkAreas?.length
    ? input.beadWorkAreas
    : input.hasBeadRefs ? [input.itemTitle] : []
  const evidenceSummary = input.evidenceSummary?.trim()
    || ((input.evidenceCount ?? 0) > 0
      ? `${input.evidenceCount} uploaded evidence file${input.evidenceCount === 1 ? '' : 's'} retained with the Manual QA origin metadata.`
      : '')
  const usefulReferences = [
    ...prdRequirements.map((requirement) => `- PRD requirement: ${requirement}`),
    ...beadWorkAreas.map((workArea) => `- Implementation work area: ${workArea}`),
    ...(evidenceSummary ? [`- Evidence summary: ${evidenceSummary}`] : []),
    ...(input.links ?? []).map((link) => `- ${link.label ? `${link.label}: ` : ''}${link.url}`),
  ]
  return [
    '',
    '## Manual QA Context',
    'This follow-up was created from a non-blocking Manual QA improvement. Treat this section as implementation context, not as a blocker for the original ticket.',
    ...(input.userNote?.trim() ? ['', '### User Note', input.userNote.trim()] : []),
    ...(input.expectedResult.trim() || input.improvementTitle?.trim() ? [
      '',
      '### Improvement Request',
      ...(input.improvementTitle?.trim() ? [input.improvementTitle.trim()] : []),
      ...(input.expectedResult.trim() ? [`Expected result: ${input.expectedResult.trim()}`] : []),
    ] : []),
    '',
    '### Checklist Item',
    `- Title: ${input.itemTitle}`,
    `- Related behavior/requirement: ${input.behavior}`,
    ...(input.source ? [`- Source: ${input.source}`] : []),
    ...(input.actions?.length ? ['- User actions checked:', ...input.actions.map((action, index) => `  ${index + 1}. ${action}`)] : []),
    ...(input.observation?.trim() ? [`- Observed behavior: ${input.observation.trim()}`] : []),
    ...(usefulReferences.length ? [
      '',
      '### Useful References',
      ...usefulReferences,
    ] : []),
  ].join('\n')
}

export function createManualQaImprovementDraftId(version: number, itemId: string): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('Manual QA version must be a positive integer.')
  const prefix = `improvement-v${version}-`
  const safeItemId = itemId.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160 - prefix.length)
  return `${prefix}${safeItemId}`
}

export function composeManualQaImprovementDescription(
  input: ManualQaImprovementDescriptionInput,
  maxLength = 10_000,
): ManualQaImprovementDescriptionResult {
  const omittedFields: string[] = []
  const retained = input.description.slice(0, maxLength)
  if (retained.length < input.description.length) omittedFields.push('userEditedDescription')
  const context = input.contextOverride ?? buildManualQaImprovementContext(input)
  const requestedLength = input.description.length + 1 + context.length
  let description = retained
  if (context.trim()) {
    const available = maxLength - description.length
    if (available <= 1) omittedFields.push('manualQaContext')
    else {
      description += `\n${context}`.slice(0, available)
      if (`\n${context}`.length > available) omittedFields.push('manualQaContext')
    }
  }
  if ((input.evidenceCount ?? 0) > 0) omittedFields.push('binaryEvidenceMetadataOnly')
  if (input.hasPrdRefs) omittedFields.push('prdIdsMetadataOnly')
  if (input.hasBeadRefs) omittedFields.push('beadIdsMetadataOnly')
  return {
    description: description.slice(0, maxLength),
    context,
    requestedLength,
    omittedCharacters: Math.max(0, requestedLength - maxLength),
    omittedFields: [...new Set(omittedFields)],
  }
}
