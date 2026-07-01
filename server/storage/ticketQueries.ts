import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db as appDb } from '../db/index'
import { PROFILE_DEFAULTS } from '../db/defaults'
import { getProjectContextById, getProjectById, listProjects } from './projects'
import { opencodeSessions, phaseArtifacts, profiles, projects, ticketErrorOccurrences, tickets } from '../db/schema'
import {
  getTicketAiLogPath,
  getTicketDir,
  getTicketDebugLogPath,
  getTicketExecutionLogPath,
  getTicketExecutionSetupDir,
  getTicketExecutionSetupProfilePath,
  getTicketWorktreePath,
} from './paths'
import { readJsonl } from '../io/jsonl'
import { getAvailableWorkflowActions } from '@shared/workflowMeta'
import {
  FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
  FINAL_TEST_FILE_EFFECTS_ERROR_CODE,
  FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
} from '@shared/finalTestFileEffects'
import { getTicketBeadsPath, resolveTicketBaseBranch } from '../ticket/metadata'
import type { ArtifactSnapshot } from '../sse/eventTypes'
import { EXECUTION_BAND_STATUSES } from '../workflow/executionBand'
import { normalizeBlockedErrorDiagnostics, type BlockedErrorDiagnostics } from '@shared/errorDiagnostics'
import { isContinuableBlockedError } from '../opencode/sessionContinuation'
import { computeEtaRange, type EtaRange } from '../workflow/eta/computeEta'
import { bucketForBeadCount, getThroughputSamples, getTicketBeadSamples } from './executionTelemetry'

type LocalTicketRow = typeof tickets.$inferSelect
type LocalProjectRow = typeof projects.$inferSelect

export const DISPLAY_ONLY_MOCK_BRANCH_NAME = '__looptroop_display_only_mock__'

export function isDisplayOnlyMockTicket(ticket: Pick<LocalTicketRow, 'branchName'>): boolean {
  return ticket.branchName === DISPLAY_ONLY_MOCK_BRANCH_NAME
}

function getDisplayOnlyMockTicketActions(status: string): string[] {
  return status === 'COMPLETED' || status === 'CANCELED' ? [] : ['cancel']
}

const TrimmedNonEmptyStringSchema = z.string().trim().min(1)
const LockedCouncilMembersSchema = z.array(TrimmedNonEmptyStringSchema)
const LockedCouncilMemberVariantsSchema = z.record(z.string(), TrimmedNonEmptyStringSchema).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (key.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Council member variant keys must be non-empty strings.',
      })
      return
    }
  }
})

function truncateLoggedValue(value: string, maxLength = 200): string {
  const trimmed = value.trim()
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed
}

function warnInvalidDbJson(fieldName: string, raw: string, detail: string): void {
  console.warn(`[tickets] Invalid ${fieldName} JSON in database: ${truncateLoggedValue(raw)} (${detail})`)
}

export type TicketErrorResolutionStatus = 'RETRIED' | 'CONTINUED' | 'CANCELED'

/** An individual error occurrence recorded while a ticket was in BLOCKED_ERROR. */
export interface TicketErrorOccurrence {
  id: number
  ticketId: number
  occurrenceNumber: number
  blockedFromStatus: string
  errorMessage: string | null
  errorCodes: string[]
  diagnostics?: BlockedErrorDiagnostics | null
  occurredAt: string
  resolvedAt: string | null
  resolutionStatus: TicketErrorResolutionStatus | null
  resumedToStatus: string | null
}

/** Full public projection of a ticket row, enriched with runtime data, error history, and available actions. */
export interface PublicTicket extends Omit<LocalTicketRow, 'id' | 'lockedCouncilMembers' | 'lockedCouncilMemberVariants'> {
  id: string
  projectId: number
  isDisplayOnlyMock: boolean
  lockedCouncilMembers: string[]
  lockedCouncilMemberVariants: Record<string, string> | null
  availableActions: string[]
  previousStatus: string | null
  reviewCutoffStatus: string | null
  errorOccurrences: TicketErrorOccurrence[]
  activeErrorOccurrenceId: number | null
  hasPastErrors: boolean
  errorSeenSignature: string | null
  needsInputSeenSignature: string | null
  completionDisposition: 'merged' | 'closed_unmerged' | null
  cleanup: {
    status: 'clean' | 'warning' | null
    errorCount: number
    latestReportArtifactId: number | null
  }
  runtime: {
    baseBranch: string
    currentBead: number
    completedBeads: number
    totalBeads: number
    percentComplete: number
    iterationCount: number
    maxIterations: number | null
    maxIterationsPerBead: number | null
    perIterationTimeoutMs: number | null
    activeBeadId: string | null
    activeBeadIteration: number | null
    lastFailedBeadId: string | null
    artifactRoot: string
    beads: Array<{
      id: string
      title: string
      status: string
      iteration: number
      notes?: string
      startedAt?: string | null
      updatedAt?: string | null
    }>
    candidateCommitSha: string | null
    preSquashHead: string | null
    finalTestStatus: 'passed' | 'failed' | 'pending'
    prNumber: number | null
    prUrl: string | null
    prState: 'draft' | 'open' | 'merged' | 'closed' | null
    prHeadSha: string | null
    eta: EtaRange | null
  }
}

export type PublicPhaseArtifactRow = ArtifactSnapshot

/** Resolved storage and database references for processing a ticket in API routes. */
export interface TicketContext {
  ticketRef: string
  externalId: string
  projectId: number
  projectRoot: string
  localProject: LocalProjectRow
  localTicket: LocalTicketRow
  localTicketId: number
  projectDb: NonNullable<ReturnType<typeof getProjectContextById>>['projectDb']
}

export function buildTicketRef(projectId: number, externalId: string): string {
  return `${projectId}:${externalId}`
}

export function parseTicketRef(ticketRef: string): { projectId: number; externalId: string } | null {
  const separator = ticketRef.indexOf(':')
  if (separator <= 0) return null
  const projectId = Number(ticketRef.slice(0, separator))
  const externalId = ticketRef.slice(separator + 1)
  if (Number.isNaN(projectId) || !externalId) return null
  return { projectId, externalId }
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function normalizeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeModelList(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const modelId = normalizeModelId(value)
    if (!modelId || unique.has(modelId)) continue
    unique.add(modelId)
    normalized.push(modelId)
  }

  return normalized
}

export function parseLockedCouncilMembers(raw: string | null | undefined): string[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    const result = LockedCouncilMembersSchema.safeParse(parsed)
    if (!result.success) {
      warnInvalidDbJson('lockedCouncilMembers', raw, result.error.message)
      return []
    }
    return normalizeModelList(result.data)
  } catch (error) {
    warnInvalidDbJson('lockedCouncilMembers', raw, error instanceof Error ? error.message : String(error))
    return []
  }
}

export function parseLockedCouncilMemberVariants(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    const result = LockedCouncilMemberVariantsSchema.safeParse(parsed)
    if (!result.success) {
      warnInvalidDbJson('lockedCouncilMemberVariants', raw, result.error.message)
      return null
    }

    return Object.fromEntries(
      Object.entries(result.data).map(([key, value]) => [key.trim(), value]),
    )
  } catch (error) {
    warnInvalidDbJson('lockedCouncilMemberVariants', raw, error instanceof Error ? error.message : String(error))
    return null
  }
}

export function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false
  if (leftSet.size !== rightSet.size) return false
  return [...leftSet].every((value) => rightSet.has(value))
}

export function isValidResolutionStatus(v: unknown): v is TicketErrorResolutionStatus {
  return v === 'RETRIED' || v === 'CONTINUED' || v === 'CANCELED'
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseTicketErrorCodes(raw: string | null | undefined): string[] {
  if (!raw) return []
  const parsed = parseJsonObject<unknown>(raw)
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
}

function parseTicketErrorDiagnostics(raw: string | null | undefined): BlockedErrorDiagnostics | null {
  if (!raw) return null
  const parsed = parseJsonObject<unknown>(raw)
  return normalizeBlockedErrorDiagnostics(parsed)
}

function readTicketErrorOccurrences(
  projectContext: NonNullable<ReturnType<typeof getProjectContextById>> | null | undefined,
  localTicketId: number,
): TicketErrorOccurrence[] {
  if (!projectContext) return []

  const rows = projectContext.projectDb.select({
    id: ticketErrorOccurrences.id,
    ticketId: ticketErrorOccurrences.ticketId,
    occurrenceNumber: ticketErrorOccurrences.occurrenceNumber,
    blockedFromStatus: ticketErrorOccurrences.blockedFromStatus,
    errorMessage: ticketErrorOccurrences.errorMessage,
    errorCodes: ticketErrorOccurrences.errorCodes,
    diagnosticDetails: ticketErrorOccurrences.diagnosticDetails,
    occurredAt: ticketErrorOccurrences.occurredAt,
    resolvedAt: ticketErrorOccurrences.resolvedAt,
    resolutionStatus: ticketErrorOccurrences.resolutionStatus,
    resumedToStatus: ticketErrorOccurrences.resumedToStatus,
  })
    .from(ticketErrorOccurrences)
    .where(eq(ticketErrorOccurrences.ticketId, localTicketId))
    .orderBy(asc(ticketErrorOccurrences.occurrenceNumber))
    .all()

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    occurrenceNumber: row.occurrenceNumber,
    blockedFromStatus: row.blockedFromStatus,
    errorMessage: row.errorMessage,
    errorCodes: parseTicketErrorCodes(row.errorCodes),
    diagnostics: parseTicketErrorDiagnostics(row.diagnosticDetails),
    occurredAt: row.occurredAt,
    resolvedAt: row.resolvedAt,
    resolutionStatus: isValidResolutionStatus(row.resolutionStatus) ? row.resolutionStatus : null,
    resumedToStatus: row.resumedToStatus,
  }))
}

function readActiveErrorOccurrenceId(errorOccurrences: TicketErrorOccurrence[]): number | null {
  for (let index = errorOccurrences.length - 1; index >= 0; index -= 1) {
    const occurrence = errorOccurrences[index]
    if (!occurrence) continue
    if (!occurrence.resolvedAt) return occurrence.id
  }
  return null
}

export interface TicketContinuationCandidate {
  ticketId: string
  projectId: number
  localTicketId: number
  previousStatus: string
  sessionId: string
}

function resolveTicketContinuationCandidateFromRows(
  projectContext: NonNullable<ReturnType<typeof getProjectContextById>> | null | undefined,
  projectId: number,
  ticket: LocalTicketRow,
  previousStatus: string | null,
  errorOccurrences: TicketErrorOccurrence[],
  activeErrorOccurrenceId: number | null,
): TicketContinuationCandidate | null {
  if (!projectContext || ticket.status !== 'BLOCKED_ERROR' || !previousStatus || activeErrorOccurrenceId === null) {
    return null
  }

  const occurrence = errorOccurrences.find((candidate) => candidate.id === activeErrorOccurrenceId)
  if (!occurrence || occurrence.resolvedAt !== null) return null
  if (!isContinuableBlockedError({
    diagnostics: occurrence.diagnostics,
    errorCodes: occurrence.errorCodes,
  })) {
    return null
  }

  const sessionId = occurrence.diagnostics?.sessionId?.trim()
  if (!sessionId) return null

  const activeSession = projectContext.projectDb.select({ id: opencodeSessions.id })
    .from(opencodeSessions)
    .where(and(
      eq(opencodeSessions.ticketId, ticket.id),
      eq(opencodeSessions.sessionId, sessionId),
      eq(opencodeSessions.phase, previousStatus),
      eq(opencodeSessions.state, 'active'),
    ))
    .get()
  if (!activeSession) return null

  return {
    ticketId: buildTicketRef(projectId, ticket.externalId),
    projectId,
    localTicketId: ticket.id,
    previousStatus,
    sessionId,
  }
}

/**
 * Injects `'continue'` into a ticket’s available actions when a resumable
 * OpenCode session exists for the current BLOCKED_ERROR. Inserted right after
 * `'retry'` so the UI shows them together.
 */
function addContinueActionWhenAvailable(
  actions: string[],
  candidate: TicketContinuationCandidate | null,
): string[] {
  if (!candidate || actions.includes('continue')) return actions
  const retryIndex = actions.indexOf('retry')
  if (retryIndex === -1) return [...actions, 'continue']
  return [
    ...actions.slice(0, retryIndex + 1),
    'continue',
    ...actions.slice(retryIndex + 1),
  ]
}

function addFinalTestFileEffectActionsWhenAvailable(
  actions: string[],
  activeErrorOccurrence: TicketErrorOccurrence | null,
): string[] {
  if (
    !activeErrorOccurrence
    || activeErrorOccurrence.resolvedAt !== null
    || !activeErrorOccurrence.errorCodes.includes(FINAL_TEST_FILE_EFFECTS_ERROR_CODE)
  ) {
    return actions
  }

  const additions = [
    FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
    FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
  ].filter((action) => !actions.includes(action))
  if (additions.length === 0) return actions

  const retryIndex = actions.indexOf('retry')
  if (retryIndex === -1) return [...additions, ...actions]
  return [
    ...actions.slice(0, retryIndex + 1),
    ...additions,
    ...actions.slice(retryIndex + 1),
  ]
}

function readErrorSeenSignature(projectContext: NonNullable<ReturnType<typeof getProjectContextById>>, localTicketId: number): string | null {
  const artifact = projectContext.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, localTicketId),
      eq(phaseArtifacts.phase, 'UI_STATE'),
      eq(phaseArtifacts.artifactType, 'ui_state:error_attention'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  if (!artifact) return null

  const parsed = parseJsonObject<{ data?: { seenSignature?: unknown } }>(artifact.content)
  return typeof parsed?.data?.seenSignature === 'string' ? parsed.data.seenSignature : null
}

function readNeedsInputSeenSignature(projectContext: NonNullable<ReturnType<typeof getProjectContextById>>, localTicketId: number): string | null {
  const artifact = projectContext.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, localTicketId),
      eq(phaseArtifacts.phase, 'UI_STATE'),
      eq(phaseArtifacts.artifactType, 'ui_state:needs_input_attention'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  if (!artifact) return null

  const parsed = parseJsonObject<{ data?: { seenSignature?: unknown } }>(artifact.content)
  return typeof parsed?.data?.seenSignature === 'string' ? parsed.data.seenSignature : null
}

/**
 * Determines the status a reviewer should scroll to when viewing a ticket’s
 * artifact history. For BLOCKED_ERROR it returns the phase that was active when
 * the error occurred; for CANCELED it unwinds through a possible double-error.
 */
export function resolveReviewCutoffStatus(
  ticketStatus: string,
  previousStatus: string | null,
  latestBlockedErrorPreviousStatus: string | null = null,
): string | null {
  if (ticketStatus === 'BLOCKED_ERROR') {
    return previousStatus
  }

  if (ticketStatus !== 'CANCELED') {
    return null
  }

  if (previousStatus !== 'BLOCKED_ERROR') {
    return previousStatus
  }

  return latestBlockedErrorPreviousStatus ?? null
}

function readReviewCutoffStatus(
  ticket: LocalTicketRow,
  previousStatus: string | null,
  errorOccurrences: TicketErrorOccurrence[],
): string | null {
  const latestBlockedErrorPreviousStatus = previousStatus === 'BLOCKED_ERROR'
    ? errorOccurrences.at(-1)?.blockedFromStatus ?? null
    : null

  return resolveReviewCutoffStatus(ticket.status, previousStatus, latestBlockedErrorPreviousStatus)
}

/** Converts a raw database ticket row into a fully enriched public ticket with runtime data, actions, and error history. */
export function toPublicTicket(projectId: number, ticket: LocalTicketRow): PublicTicket {
  const project = getProjectById(projectId)
  const projectContext = getProjectContextById(projectId)
  const isMockTicket = isDisplayOnlyMockTicket(ticket)
  const baseBranch = project ? resolveTicketBaseBranch(project.folderPath, ticket.externalId) : 'unknown'
  const lockedCouncilMembers = parseLockedCouncilMembers(ticket.lockedCouncilMembers)
  const lockedCouncilMemberVariants = parseLockedCouncilMemberVariants(ticket.lockedCouncilMemberVariants)
  const snapshot = parseJsonObject<{ context?: { previousStatus?: unknown } }>(ticket.xstateSnapshot)
  const errorOccurrences = readTicketErrorOccurrences(projectContext, ticket.id)
  const activeErrorOccurrenceId = readActiveErrorOccurrenceId(errorOccurrences)
  const activeErrorOccurrence = activeErrorOccurrenceId == null
    ? null
    : errorOccurrences.find((occurrence) => occurrence.id === activeErrorOccurrenceId) ?? null
  const previousStatusFromSnapshot = typeof snapshot?.context?.previousStatus === 'string' ? snapshot.context.previousStatus : null
  const previousStatus = previousStatusFromSnapshot
    ?? (ticket.status === 'BLOCKED_ERROR' ? errorOccurrences.at(-1)?.blockedFromStatus ?? null : null)
  const reviewCutoffStatus = readReviewCutoffStatus(ticket, previousStatus, errorOccurrences)
  const errorSeenSignature = projectContext ? readErrorSeenSignature(projectContext, ticket.id) : null
  const needsInputSeenSignature = projectContext ? readNeedsInputSeenSignature(projectContext, ticket.id) : null
  const continuationCandidate = resolveTicketContinuationCandidateFromRows(
    projectContext,
    projectId,
    ticket,
    previousStatus,
    errorOccurrences,
    activeErrorOccurrenceId,
  )
  const runtime = project ? buildRuntime(projectId, project.folderPath, ticket, baseBranch, previousStatus) : {
    baseBranch,
    currentBead: ticket.currentBead ?? 0,
    completedBeads: 0,
    totalBeads: ticket.totalBeads ?? 0,
    percentComplete: Math.round(ticket.percentComplete ?? 0),
    iterationCount: 0,
    maxIterations: null,
    maxIterationsPerBead: null,
    perIterationTimeoutMs: null,
    activeBeadId: null,
    activeBeadIteration: null,
    lastFailedBeadId: null,
    artifactRoot: '',
    beads: [],
    candidateCommitSha: null,
    preSquashHead: null,
    finalTestStatus: 'pending' as const,
    prNumber: null,
    prUrl: null,
    prState: null,
    prHeadSha: null,
    eta: null,
  }
  const completionDisposition = readCompletionDisposition(projectContext, ticket.id)
  const cleanup = readCleanupSummary(projectContext, ticket.id)

  return {
    ...ticket,
    id: buildTicketRef(projectId, ticket.externalId),
    projectId,
    isDisplayOnlyMock: isMockTicket,
    lockedCouncilMembers,
    lockedCouncilMemberVariants,
    availableActions: isMockTicket
      ? getDisplayOnlyMockTicketActions(ticket.status)
      : addFinalTestFileEffectActionsWhenAvailable(
        addContinueActionWhenAvailable(
          getAvailableWorkflowActions(ticket.status),
          continuationCandidate,
        ),
        activeErrorOccurrence,
      ),
    previousStatus,
    reviewCutoffStatus,
    errorOccurrences,
    activeErrorOccurrenceId,
    hasPastErrors: errorOccurrences.some((occurrence) => occurrence.resolvedAt !== null),
    errorSeenSignature,
    needsInputSeenSignature,
    completionDisposition,
    cleanup,
    runtime,
  }
}

function readCleanupSummary(
  projectContext: NonNullable<ReturnType<typeof getProjectContextById>> | null | undefined,
  localTicketId: number,
): PublicTicket['cleanup'] {
  if (!projectContext) {
    return { status: null, errorCount: 0, latestReportArtifactId: null }
  }

  const artifact = projectContext.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, localTicketId),
      eq(phaseArtifacts.artifactType, 'cleanup_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  if (!artifact?.content) {
    return { status: null, errorCount: 0, latestReportArtifactId: null }
  }

  const parsed = parseJsonObject<{ status?: unknown; errors?: unknown }>(artifact.content)
  const errors = Array.isArray(parsed?.errors)
    ? parsed.errors.filter((entry) => typeof entry === 'string')
    : []
  const status = parsed?.status === 'warning'
    ? 'warning'
    : parsed?.status === 'clean'
      ? 'clean'
      : errors.length > 0 ? 'warning' : 'clean'

  return {
    status,
    errorCount: errors.length,
    latestReportArtifactId: artifact.id,
  }
}

function readCompletionDisposition(
  projectContext: NonNullable<ReturnType<typeof getProjectContextById>> | null | undefined,
  localTicketId: number,
): PublicTicket['completionDisposition'] {
  if (!projectContext) return null

  const artifact = projectContext.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, localTicketId),
      eq(phaseArtifacts.artifactType, 'merge_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()

  if (!artifact?.content) return null

  const parsed = parseJsonObject<{ disposition?: unknown }>(artifact.content)
  return parsed?.disposition === 'merged' || parsed?.disposition === 'closed_unmerged'
    ? parsed.disposition
    : null
}

function buildRuntime(
  projectId: number,
  projectRoot: string,
  ticket: LocalTicketRow,
  baseBranch: string,
  previousStatus: string | null,
): PublicTicket['runtime'] {
  const projectContext = getProjectContextById(projectId)
  const profile = appDb.select().from(profiles).get()
  const snapshot = parseJsonObject<{ context?: { maxIterations?: unknown } }>(ticket.xstateSnapshot)
  const maxIterations = typeof snapshot?.context?.maxIterations === 'number'
    ? snapshot.context.maxIterations
    : projectContext?.project.maxIterations
      ?? profile?.maxIterations
      ?? PROFILE_DEFAULTS.maxIterations
  const perIterationTimeoutMs = projectContext?.project.perIterationTimeout
    ?? profile?.perIterationTimeout
    ?? PROFILE_DEFAULTS.perIterationTimeout
  const finalTestArtifact = projectContext?.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticket.id),
      eq(phaseArtifacts.artifactType, 'final_test_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  const integrationArtifact = projectContext?.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticket.id),
      eq(phaseArtifacts.artifactType, 'integration_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  const pullRequestArtifact = projectContext?.projectDb.select().from(phaseArtifacts)
    .where(and(
      eq(phaseArtifacts.ticketId, ticket.id),
      eq(phaseArtifacts.artifactType, 'pull_request_report'),
    ))
    .orderBy(desc(phaseArtifacts.id))
    .get()
  const finalTestReport = parseJsonObject<{ status?: 'passed' | 'failed'; passed?: boolean }>(finalTestArtifact?.content)
  const integrationReport = parseJsonObject<{ candidateCommitSha?: string | null; preSquashHead?: string | null }>(integrationArtifact?.content)
  const pullRequestReport = parseJsonObject<{
    prNumber?: number | null
    prUrl?: string | null
    prState?: 'draft' | 'open' | 'merged' | 'closed' | null
    prHeadSha?: string | null
  }>(pullRequestArtifact?.content)
  const beads = readRuntimeBeads(projectRoot, ticket.externalId, baseBranch)
  const inProgressBead = beads.find((bead) => bead.status === 'in_progress') ?? null
  const lastFailedBead = [...beads]
    .filter((bead) => bead.status === 'error')
    .sort((left, right) => {
      const leftUpdatedAt = Date.parse(left.updatedAt ?? '')
      const rightUpdatedAt = Date.parse(right.updatedAt ?? '')

      if (!Number.isNaN(leftUpdatedAt) || !Number.isNaN(rightUpdatedAt)) {
        if (Number.isNaN(leftUpdatedAt)) return 1
        if (Number.isNaN(rightUpdatedAt)) return -1
        return rightUpdatedAt - leftUpdatedAt
      }

      return right.iteration - left.iteration
    })[0] ?? null
  const blockedFromCoding = ticket.status === 'BLOCKED_ERROR' && previousStatus === 'CODING'
  const totalBeads = ticket.totalBeads ?? 0
  const currentBead = ticket.currentBead ?? 0
  const completedBeads = totalBeads === 0
    ? 0
    : currentBead >= totalBeads
      ? totalBeads
      : Math.max(0, currentBead - 1)

  // ETA is only meaningful while beads are actively executing; skip it elsewhere to keep
  // list/kanban fetches cheap. Computed read-time from persisted throughput metrics.
  let eta: EtaRange | null = null
  if (ticket.status === 'CODING' && projectContext && totalBeads > 0) {
    const effortTier = ticket.lockedMainImplementerVariant || 'medium'
    const sizeBucket = bucketForBeadCount(totalBeads)
    eta = computeEtaRange({
      remaining: Math.max(0, totalBeads - completedBeads),
      historySamples: getThroughputSamples(projectContext.projectDb, { effortTier, sizeBucket, excludeTicketId: ticket.id }),
      currentRunSamples: getTicketBeadSamples(projectContext.projectDb, ticket.id),
    })
  }

  return {
    baseBranch,
    currentBead,
    completedBeads,
    totalBeads,
    percentComplete: Math.round(ticket.percentComplete ?? 0),
    iterationCount: 0,
    maxIterations,
    maxIterationsPerBead: maxIterations,
    perIterationTimeoutMs,
    activeBeadId: inProgressBead?.id ?? (blockedFromCoding ? lastFailedBead?.id ?? null : null),
    activeBeadIteration: inProgressBead?.iteration ?? (blockedFromCoding ? lastFailedBead?.iteration ?? null : null),
    lastFailedBeadId: blockedFromCoding ? lastFailedBead?.id ?? null : null,
    artifactRoot: getTicketDir(projectRoot, ticket.externalId),
    beads: beads.map((bead) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      iteration: bead.iteration,
      notes: bead.notes,
      startedAt: bead.startedAt,
    })),
    candidateCommitSha: integrationReport?.candidateCommitSha ?? null,
    preSquashHead: integrationReport?.preSquashHead ?? null,
    finalTestStatus: finalTestReport?.status ?? (finalTestReport?.passed ? 'passed' : 'pending'),
    prNumber: typeof pullRequestReport?.prNumber === 'number' ? pullRequestReport.prNumber : null,
    prUrl: typeof pullRequestReport?.prUrl === 'string' ? pullRequestReport.prUrl : null,
    prState: pullRequestReport?.prState ?? null,
    prHeadSha: typeof pullRequestReport?.prHeadSha === 'string' ? pullRequestReport.prHeadSha : null,
    eta,
  }
}

function readRuntimeBeads(projectRoot: string, externalId: string, baseBranch: string) {
  try {
    return readJsonl<Record<string, unknown>>(getTicketBeadsPath(projectRoot, externalId, baseBranch))
      .map((bead) => ({
        id: typeof bead.id === 'string' ? bead.id : '',
        title: typeof bead.title === 'string' ? bead.title : 'Untitled',
        status: typeof bead.status === 'string' ? bead.status : 'pending',
        iteration: typeof bead.iteration === 'number' ? bead.iteration : 0,
        notes: typeof bead.notes === 'string' ? bead.notes : '',
        updatedAt: typeof bead.updatedAt === 'string' ? bead.updatedAt : null,
        startedAt: typeof bead.startedAt === 'string' ? bead.startedAt : null,
      }))
      .filter((bead) => bead.id.length > 0)
  } catch {
    return []
  }
}

export interface ExecutionBandConflict {
  ticketId: string
  externalId: string
  title: string
  status: string
}

/** Returns any ticket in the project that is currently in the execution band (coding/testing/integrating), excluding `excludeTicketRef`. */
export function findProjectExecutionBandConflict(
  projectId: number,
  excludeTicketRef?: string,
): ExecutionBandConflict | null {
  const project = getProjectContextById(projectId)
  if (!project) return null

  const excludedExternalId = excludeTicketRef ? parseTicketRef(excludeTicketRef)?.externalId ?? null : null
  const executionBandStatusSet = new Set<string>(EXECUTION_BAND_STATUSES)

  const conflict = project.projectDb.select({
    externalId: tickets.externalId,
    title: tickets.title,
    status: tickets.status,
    branchName: tickets.branchName,
  })
    .from(tickets)
    .orderBy(desc(tickets.updatedAt))
    .all()
    .find((candidate) => (
      candidate.externalId !== excludedExternalId
      && !isDisplayOnlyMockTicket(candidate)
      && executionBandStatusSet.has(candidate.status)
    ))

  return conflict
    ? {
        ticketId: buildTicketRef(projectId, conflict.externalId),
        externalId: conflict.externalId,
        title: conflict.title,
        status: conflict.status,
      }
    : null
}

/** Lists all tickets across one or all projects, sorted by most recently updated. */
export function listTickets(projectId?: number): PublicTicket[] {
  const projectsToRead = projectId != null
    ? [getProjectContextById(projectId)].filter(Boolean)
    : listProjects().map(project => getProjectContextById(project.id)).filter(Boolean)
  const aggregated: PublicTicket[] = []
  for (const project of projectsToRead) {
    if (!project) continue
    const projectTickets = project.projectDb.select().from(tickets).orderBy(desc(tickets.updatedAt)).all()
    aggregated.push(...projectTickets.map(ticket => toPublicTicket(project.attached.id, ticket)))
  }
  return aggregated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** Fetches a single ticket by its composite ref (`projectId:externalId`). */
export function getTicketByRef(ticketRef: string): PublicTicket | undefined {
  const context = getTicketContext(ticketRef)
  if (!context) return undefined
  return toPublicTicket(context.projectId, context.localTicket)
}

export function findTicketRefByLocalId(localTicketId: number): string | undefined {
  for (const project of listProjects()) {
    const context = getProjectContextById(project.id)
    if (!context) continue
    const localTicket = context.projectDb.select().from(tickets).where(eq(tickets.id, localTicketId)).get()
    if (localTicket) {
      return buildTicketRef(project.id, localTicket.externalId)
    }
  }
  return undefined
}

/** Resolves full ticket context (database handles, paths, project metadata) from a composite ticket ref. */
export function getTicketContext(ticketRef: string): TicketContext | undefined {
  const parsed = parseTicketRef(ticketRef)
  if (!parsed) return undefined
  const project = getProjectContextById(parsed.projectId)
  if (!project) return undefined
  const localTicket = project.projectDb.select().from(tickets).where(eq(tickets.externalId, parsed.externalId)).get()
  if (!localTicket) return undefined
  return {
    ticketRef,
    externalId: parsed.externalId,
    projectId: parsed.projectId,
    projectRoot: project.projectRoot,
    localProject: project.project,
    localTicket,
    localTicketId: localTicket.id,
    projectDb: project.projectDb,
  }
}

export function resolveTicketContinuationCandidate(ticketRef: string): TicketContinuationCandidate | null {
  const context = getTicketContext(ticketRef)
  if (!context) return null
  const projectContext = getProjectContextById(context.projectId)
  if (!projectContext) return null
  const snapshot = parseJsonObject<{ context?: { previousStatus?: unknown } }>(context.localTicket.xstateSnapshot)
  const errorOccurrences = readTicketErrorOccurrences(projectContext, context.localTicketId)
  const activeErrorOccurrenceId = readActiveErrorOccurrenceId(errorOccurrences)
  const previousStatusFromSnapshot = typeof snapshot?.context?.previousStatus === 'string' ? snapshot.context.previousStatus : null
  const previousStatus = previousStatusFromSnapshot
    ?? (context.localTicket.status === 'BLOCKED_ERROR' ? errorOccurrences.at(-1)?.blockedFromStatus ?? null : null)

  return resolveTicketContinuationCandidateFromRows(
    projectContext,
    context.projectId,
    context.localTicket,
    previousStatus,
    errorOccurrences,
    activeErrorOccurrenceId,
  )
}

export function getTicketStorageContext(ticketRef: string): { projectId: number; projectRoot: string; externalId: string } | undefined {
  const parsed = parseTicketRef(ticketRef)
  if (!parsed) return undefined
  const project = getProjectById(parsed.projectId)
  if (!project) return undefined
  return {
    projectId: parsed.projectId,
    projectRoot: project.folderPath,
    externalId: parsed.externalId,
  }
}

export function listNonTerminalTickets(): PublicTicket[] {
  return listTickets().filter(ticket => (
    !['COMPLETED', 'CANCELED'].includes(ticket.status)
    && !isDisplayOnlyMockTicket(ticket)
  ))
}

export function getTicketPaths(ticketRef: string): {
  worktreePath: string
  ticketDir: string
  executionLogPath: string
  debugLogPath: string
  aiLogPath: string
  executionSetupDir: string
  executionSetupProfilePath: string
  baseBranch: string
  beadsPath: string
} | undefined {
  const storage = getTicketStorageContext(ticketRef)
  if (!storage) return undefined
  const baseBranch = resolveTicketBaseBranch(storage.projectRoot, storage.externalId)
  return {
    worktreePath: getTicketWorktreePath(storage.projectRoot, storage.externalId),
    ticketDir: getTicketDir(storage.projectRoot, storage.externalId),
    executionLogPath: getTicketExecutionLogPath(storage.projectRoot, storage.externalId),
    debugLogPath: getTicketDebugLogPath(storage.projectRoot, storage.externalId),
    aiLogPath: getTicketAiLogPath(storage.projectRoot, storage.externalId),
    executionSetupDir: getTicketExecutionSetupDir(storage.projectRoot, storage.externalId),
    executionSetupProfilePath: getTicketExecutionSetupProfilePath(storage.projectRoot, storage.externalId),
    baseBranch,
    beadsPath: getTicketBeadsPath(storage.projectRoot, storage.externalId, baseBranch),
  }
}
