import { z } from 'zod'

export const MANUAL_QA_SCHEMA_VERSION = 1 as const
export const MAX_MANUAL_QA_EVIDENCE_BYTES = 250 * 1024 * 1024

const NonEmptyString = z.string().trim().min(1)
const IdString = NonEmptyString.max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const ManualQaPrdReferenceSchema = z.object({
  ref: NonEmptyString,
  coverage: z.enum(['full', 'partial']),
}).strict()

export const ManualQaChecklistItemSchema = z.object({
  id: IdString,
  lineageId: IdString,
  priorItemIds: z.array(IdString).default([]),
  title: NonEmptyString.max(500),
  source: z.enum(['prd', 'bead', 'previous_qa', 'implementation_diff']),
  behavior: NonEmptyString,
  severity: z.enum(['required', 'optional']),
  recheckState: z.enum(['new', 'pending_recheck', 'previously_passed']),
  prerequisites: z.array(NonEmptyString),
  actions: z.array(NonEmptyString).min(1),
  expectedResult: NonEmptyString,
  watchNotes: z.array(NonEmptyString).default([]),
  beadRefs: z.array(IdString).default([]),
  prdRefs: z.array(ManualQaPrdReferenceSchema).default([]),
}).strict()

export const ManualQaChecklistSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  artifact: z.literal('manual_qa_checklist'),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  summary: NonEmptyString,
  items: z.array(ManualQaChecklistItemSchema).min(1),
}).strict().superRefine((checklist, ctx) => {
  const ids = new Set<string>()
  const lineages = new Set<string>()
  for (const [index, item] of checklist.items.entries()) {
    if (ids.has(item.id)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: `Duplicate checklist item id: ${item.id}` })
    }
    ids.add(item.id)
    if (lineages.has(item.lineageId)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'lineageId'], message: `Duplicate active lineage id: ${item.lineageId}` })
    }
    lineages.add(item.lineageId)
  }
})

export const ManualQaEvidenceRefSchema = z.object({
  id: IdString,
  itemId: IdString,
  originalName: NonEmptyString.max(255),
  storedName: NonEmptyString.max(255),
  mediaType: NonEmptyString.max(255),
  size: z.number().int().nonnegative().max(MAX_MANUAL_QA_EVIDENCE_BYTES),
  sha256: Sha256,
  inlinePreview: z.boolean(),
  createdAt: z.string().datetime(),
}).strict()

export const ManualQaImprovementDraftSchema = z.object({
  id: IdString,
  itemId: IdString,
  title: NonEmptyString.max(500),
  description: NonEmptyString.max(10_000),
  contextOverride: NonEmptyString.max(10_000).optional(),
  evidenceIds: z.array(IdString).default([]),
}).strict()

export const ManualQaEvidenceLinkSchema = z.object({
  id: IdString,
  url: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'Evidence links must use HTTP or HTTPS.'),
  label: z.string().trim().max(500).optional(),
}).strict()

export const ManualQaItemResultSchema = z.object({
  itemId: IdString,
  outcome: z.enum(['pass', 'fail', 'waive', 'improvement', 'pending']),
  note: z.string().max(20_000).default(''),
  observation: z.string().max(20_000).default(''),
  reason: z.string().max(20_000).default(''),
  evidenceIds: z.array(IdString).default([]),
  links: z.array(ManualQaEvidenceLinkSchema).default([]),
  improvementDraftId: IdString.optional(),
  mergeGroupId: IdString.optional(),
}).strict().superRefine((result, ctx) => {
  if (result.outcome === 'fail' && !result.observation.trim()) {
    ctx.addIssue({ code: 'custom', path: ['observation'], message: 'A failed item requires an observation.' })
  }
  if (result.outcome === 'waive' && !result.reason.trim()) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A waived item requires a reason.' })
  }
  if (result.outcome === 'improvement' && !result.improvementDraftId) {
    ctx.addIssue({ code: 'custom', path: ['improvementDraftId'], message: 'An improvement requires a reviewed ticket draft.' })
  }
})

export const ManualQaDraftSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  artifact: z.literal('manual_qa_draft'),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  checklistHash: Sha256,
  draftRevision: z.number().int().nonnegative(),
  results: z.array(ManualQaItemResultSchema),
  improvements: z.array(ManualQaImprovementDraftSchema),
  evidence: z.array(ManualQaEvidenceRefSchema),
  updatedAt: z.string().datetime(),
}).strict()

export const ManualQaResultsSchema = ManualQaDraftSchema.omit({ artifact: true }).extend({
  artifact: z.literal('manual_qa_results'),
  actionId: IdString,
  submittedAt: z.string().datetime(),
}).strict()

export const ManualQaCoverageEntrySchema = z.object({
  criterionRef: NonEmptyString,
  criterion: NonEmptyString,
  status: z.enum(['covered', 'partially_covered', 'uncovered']),
  itemIds: z.array(IdString),
}).strict()

export const ManualQaCoverageSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  artifact: z.literal('manual_qa_coverage'),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  entries: z.array(ManualQaCoverageEntrySchema),
  coveredCount: z.number().int().nonnegative(),
  partiallyCoveredCount: z.number().int().nonnegative(),
  uncoveredCount: z.number().int().nonnegative(),
  sourceItemCounts: z.object({
    prd: z.number().int().nonnegative(),
    bead: z.number().int().nonnegative(),
    previousQa: z.number().int().nonnegative(),
    implementationDiff: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export const ManualQaModelCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  artifact: z.literal('manual_qa_model_capability'),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  modelId: NonEmptyString.nullable(),
  modelVariant: NonEmptyString.nullable(),
  capabilityLookup: z.enum(['available', 'unavailable']),
  supportsImages: z.boolean().nullable(),
  imageEvidenceMode: z.enum(['attached', 'references_only']),
  capturedAt: z.string().datetime(),
}).strict()

export const ManualQaItemCountsSchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  waive: z.number().int().nonnegative(),
  improvement: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
}).strict()

export const ManualQaSummaryCoverageSchema = z.object({
  covered: z.number().int().nonnegative(),
  partiallyCovered: z.number().int().nonnegative(),
  uncovered: z.number().int().nonnegative(),
}).strict()

export const ManualQaSummarySchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  artifact: z.literal('manual_qa_summary'),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  outcome: z.enum(['passed', 'waived_through', 'skipped', 'failed', 'created_fixes']),
  createdFixBeadIds: z.array(IdString),
  improvementTicketIds: z.array(NonEmptyString),
  waivedItemIds: z.array(IdString),
  waivedItems: z.array(z.object({ itemId: IdString, reason: NonEmptyString }).strict()),
  skipReason: z.string().max(20_000).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  itemCounts: ManualQaItemCountsSchema,
  requiredItemCount: z.number().int().nonnegative(),
  optionalItemCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  nextAction: z.enum(['integrate', 'return_to_coding']),
  coverage: ManualQaSummaryCoverageSchema,
  modelCapability: ManualQaModelCapabilitySnapshotSchema.nullable(),
}).strict()

export const ManualQaImprovementOriginSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  source: z.literal('manual_qa_improvement'),
  originId: NonEmptyString,
  actionId: NonEmptyString,
  sourceTicketId: NonEmptyString,
  sourceTicketExternalId: NonEmptyString,
  sourceProjectId: z.number().int().positive(),
  sourceVersion: z.number().int().positive(),
  sourceItemIds: z.array(IdString).min(1),
  sourceItemTitles: z.array(NonEmptyString).min(1),
  resultType: z.literal('improvement'),
  relatedPrdRefs: z.array(NonEmptyString),
  relatedBeadRefs: z.array(NonEmptyString),
  evidenceRefs: z.array(z.object({
    id: IdString,
    originalName: NonEmptyString,
    mediaType: NonEmptyString,
    size: z.number().int().nonnegative(),
    sha256: Sha256,
    relativePath: NonEmptyString,
  }).strict()),
  omittedEvidence: z.array(z.object({ id: IdString, reason: NonEmptyString }).strict()),
  titleSha256: Sha256,
  descriptionSha256: Sha256,
  omittedFields: z.array(NonEmptyString),
  imageEvidenceMode: z.enum(['attached', 'references_only']),
  createdAt: z.string().datetime(),
}).strict()

export const ManualQaEventSchema = z.object({
  schemaVersion: z.literal(MANUAL_QA_SCHEMA_VERSION),
  eventId: IdString,
  eventType: z.enum([
    'generation_reserved',
    'checklist_ready',
    'draft_submitted',
    'improvement_created',
    'fixes_created',
    'completed',
    'skipped',
    'evidence_uploaded',
    'evidence_removed',
    'drift_included',
    'drift_discarded',
  ]),
  ticketId: NonEmptyString,
  version: z.number().int().positive(),
  actionId: NonEmptyString.optional(),
  createdAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()).default({}),
}).strict()

export type ManualQaPrdReference = z.infer<typeof ManualQaPrdReferenceSchema>
export type ManualQaChecklistItem = z.infer<typeof ManualQaChecklistItemSchema>
export type ManualQaChecklist = z.infer<typeof ManualQaChecklistSchema>
export type ManualQaEvidenceRef = z.infer<typeof ManualQaEvidenceRefSchema>
export type ManualQaImprovementDraft = z.infer<typeof ManualQaImprovementDraftSchema>
export type ManualQaEvidenceLink = z.infer<typeof ManualQaEvidenceLinkSchema>
export type ManualQaItemResult = z.infer<typeof ManualQaItemResultSchema>
export type ManualQaDraft = z.infer<typeof ManualQaDraftSchema>
export type ManualQaResults = z.infer<typeof ManualQaResultsSchema>
export type ManualQaCoverage = z.infer<typeof ManualQaCoverageSchema>
export type ManualQaModelCapabilitySnapshot = z.infer<typeof ManualQaModelCapabilitySnapshotSchema>
export type ManualQaSummary = z.infer<typeof ManualQaSummarySchema>
export type ManualQaImprovementOrigin = z.infer<typeof ManualQaImprovementOriginSchema>
export type ManualQaEvent = z.infer<typeof ManualQaEventSchema>

export interface ManualQaPrdCriterion {
  ref: string
  criterion: string
}

export interface ManualQaGenerationReservation {
  schemaVersion: typeof MANUAL_QA_SCHEMA_VERSION
  ticketId: string
  version: number
  actionId: string
  state: 'reserved' | 'complete'
  createdAt: string
  completedAt?: string
  checklistHash?: string
}
