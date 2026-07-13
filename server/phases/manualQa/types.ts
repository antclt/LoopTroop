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
  source: z.enum(['prd', 'bead', 'final_test', 'previous_qa', 'implementation']),
  behavior: NonEmptyString,
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  required: z.boolean(),
  recheckState: z.enum(['pending', 'pending_recheck', 'previously_passed']),
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
  skipReason: z.string().max(20_000).optional(),
  completedAt: z.string().datetime(),
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
export type ManualQaSummary = z.infer<typeof ManualQaSummarySchema>

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
