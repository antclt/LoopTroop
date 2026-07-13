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
  hasPrdRefs?: boolean
  hasBeadRefs?: boolean
}

export interface ManualQaImprovementDescriptionResult {
  description: string
  requestedLength: number
  omittedCharacters: number
  omittedFields: string[]
}

function buildContext(input: ManualQaImprovementDescriptionInput): string {
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
    ...(input.links?.length ? [
      '',
      '### Useful References',
      ...input.links.map((link) => `- ${link.label ? `${link.label}: ` : ''}${link.url}`),
    ] : []),
  ].join('\n')
}

export function composeManualQaImprovementDescription(
  input: ManualQaImprovementDescriptionInput,
  maxLength = 10_000,
): ManualQaImprovementDescriptionResult {
  const omittedFields: string[] = []
  const retained = input.description.slice(0, maxLength)
  if (retained.length < input.description.length) omittedFields.push('userEditedDescription')
  const context = buildContext(input)
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
    requestedLength,
    omittedCharacters: Math.max(0, requestedLength - maxLength),
    omittedFields: [...new Set(omittedFields)],
  }
}
