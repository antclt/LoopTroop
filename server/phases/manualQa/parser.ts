import { z } from 'zod'
import type { StructuredOutputResult } from '../../structuredOutput/types'
import {
  buildYamlDocument,
  collectTaggedCandidates,
  parseYamlOrJsonCandidate,
} from '../../structuredOutput/yamlUtils'
import { buildStructuredOutputFailure } from '../../structuredOutput/failure'
import { contentSha256 } from '../../lib/contentHash'
import { getErrorMessage } from '@shared/typeGuards'
import {
  MANUAL_QA_SCHEMA_VERSION,
  ManualQaChecklistSchema,
  type ManualQaChecklist,
  type ManualQaPrdCriterion,
} from './types'
import { validateManualQaPrdReferences } from './coverage'

export const MANUAL_QA_CHECKLIST_TAG = 'MANUAL_QA_CHECKLIST'

const ModelReferenceSchema = z.object({
  ref: z.string().trim().min(1),
  coverage: z.enum(['full', 'partial']),
}).strict()

const ModelItemSchema = z.object({
  lineageId: z.string().trim().min(1).max(160),
  priorItemIds: z.array(z.string().trim().min(1)).default([]),
  source: z.enum(['prd', 'bead', 'final_test', 'previous_qa', 'implementation']),
  behavior: z.string().trim().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  required: z.boolean(),
  recheckState: z.enum(['pending', 'pending_recheck', 'previously_passed']),
  prerequisites: z.array(z.string().trim().min(1)).default([]),
  actions: z.array(z.string().trim().min(1)).min(1),
  expectedResult: z.string().trim().min(1),
  watchNotes: z.array(z.string().trim().min(1)).default([]),
  beadRefs: z.array(z.string().trim().min(1)).default([]),
  prdRefs: z.array(ModelReferenceSchema).default([]),
}).strict()

const ModelChecklistSchema = z.object({
  summary: z.string().trim().min(1),
  items: z.array(ModelItemSchema).min(1),
}).strict()

const KEY_ALIASES: Record<string, string> = {
  lineage_id: 'lineageId',
  prior_item_ids: 'priorItemIds',
  recheck_state: 'recheckState',
  expected_result: 'expectedResult',
  watch_notes: 'watchNotes',
  bead_refs: 'beadRefs',
  prd_refs: 'prdRefs',
}

function normalizeAliases(value: unknown, warnings: string[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeAliases(entry, warnings))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = KEY_ALIASES[key] ?? key
    if (normalizedKey !== key) {
      warnings.push(`Normalized YAML key alias ${key} to ${normalizedKey}.`)
    }
    if (Object.prototype.hasOwnProperty.call(output, normalizedKey)) {
      throw new Error(`Duplicate checklist field after alias normalization: ${normalizedKey}`)
    }
    output[normalizedKey] = normalizeAliases(child, warnings)
  }
  return output
}

export interface ManualQaChecklistParseOptions {
  ticketId: string
  version: number
  prdCriteria: readonly ManualQaPrdCriterion[]
  generatedAt?: string
}

export type ManualQaChecklistParseResult = StructuredOutputResult<ManualQaChecklist> & {
  checklistHash?: string
}

export function parseManualQaChecklistOutput(
  rawContent: string,
  options: ManualQaChecklistParseOptions,
): ManualQaChecklistParseResult {
  const candidates = collectTaggedCandidates(rawContent, MANUAL_QA_CHECKLIST_TAG)
  if (candidates.length === 0) {
    return buildStructuredOutputFailure(rawContent, `Expected exactly one <${MANUAL_QA_CHECKLIST_TAG}> tagged YAML response.`)
  }

  const openingTags = rawContent.match(new RegExp(`<${MANUAL_QA_CHECKLIST_TAG}>`, 'gi'))?.length ?? 0
  const closingTags = rawContent.match(new RegExp(`</${MANUAL_QA_CHECKLIST_TAG}>`, 'gi'))?.length ?? 0
  if (openingTags !== 1 || closingTags !== 1) {
    return buildStructuredOutputFailure(rawContent, `Expected exactly one complete <${MANUAL_QA_CHECKLIST_TAG}> tagged YAML response.`)
  }

  const repairWarnings: string[] = []
  try {
    const parsed = parseYamlOrJsonCandidate(candidates[0]!, {
      repairWarnings,
      nestedMappingChildren: {
        items: [
          'lineage_id', 'lineageId', 'prior_item_ids', 'priorItemIds', 'source',
          'behavior', 'severity', 'required', 'recheck_state', 'recheckState',
          'prerequisites', 'actions', 'expected_result', 'expectedResult',
          'watch_notes', 'watchNotes', 'bead_refs', 'beadRefs', 'prd_refs', 'prdRefs',
        ],
      },
    })
    const model = ModelChecklistSchema.parse(normalizeAliases(parsed, repairWarnings))
    const checklist = ManualQaChecklistSchema.parse({
      schemaVersion: MANUAL_QA_SCHEMA_VERSION,
      artifact: 'manual_qa_checklist',
      ticketId: options.ticketId,
      version: options.version,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      summary: model.summary,
      items: model.items.map((item, index) => ({
        id: `qa-v${options.version}-${String(index + 1).padStart(3, '0')}`,
        ...item,
      })),
    })
    validateManualQaPrdReferences(checklist, options.prdCriteria)
    const normalizedContent = buildYamlDocument(checklist)
    return {
      ok: true,
      value: checklist,
      normalizedContent,
      checklistHash: contentSha256(normalizedContent),
      repairApplied: repairWarnings.length > 0,
      repairWarnings: [...new Set(repairWarnings)],
    }
  } catch (error) {
    const failure = buildStructuredOutputFailure(rawContent, getErrorMessage(error))
    return {
      ...failure,
      repairApplied: repairWarnings.length > 0 || failure.repairApplied,
      repairWarnings: [...new Set([...repairWarnings, ...failure.repairWarnings])],
    }
  }
}
