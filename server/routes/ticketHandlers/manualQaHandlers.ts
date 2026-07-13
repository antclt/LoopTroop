import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { Context } from 'hono'
import { ensureActorForTicket, sendTicketEvent } from '../../machines/persistence'
import { getTicketByRef, getTicketPaths } from '../../storage/tickets'
import {
  MAX_MANUAL_QA_EVIDENCE_BYTES,
  ManualQaDraftSchema,
  buildManualQaProjection,
  detectManualQaWorkspaceDrift,
  discardManualQaWorkspaceDrift,
  getManualQaChecklistHash,
  getManualQaVersionDetail,
  includeManualQaWorkspaceDrift,
  isSafeRasterMediaType,
  removeManualQaEvidence,
  resolveManualQaEvidence,
  streamManualQaEvidence,
  submitManualQa,
  skipManualQa,
  readManualQaEvidenceIndex,
  getManualQaStoragePaths,
  readManualQaEvidenceActionReceipt,
  persistManualQaEvidenceActionReceipt,
} from '../../phases/manualQa'
import { readTicketUiState } from './uiStateHandlers'
import { getRequiredRouteParam, getTicketParam } from './routeUtils'

function parseVersion(c: Context): number {
  const version = Number(getRequiredRouteParam(c, 'version'))
  if (!Number.isInteger(version) || version < 1) throw new Error('Manual QA version must be a positive integer.')
  return version
}

type RequiredTicket = {
  ticketId: string
  ticket: NonNullable<ReturnType<typeof getTicketByRef>>
  paths: NonNullable<ReturnType<typeof getTicketPaths>>
}

function requireTicket(c: Context): RequiredTicket | null {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  const paths = getTicketPaths(ticketId)
  if (!ticket || !paths) return null
  return { ticketId, ticket, paths }
}

function readManualQaDraftState(ticketId: string, version: number) {
  return readTicketUiState(ticketId, `manual_qa_draft:v${version}`)
}

function assertServerDraftRevision(ticketId: string, version: number, expectedRevision: number) {
  const latest = readManualQaDraftState(ticketId, version)
  const revision = latest?.revision ?? 0
  if (revision !== expectedRevision) {
    const error = new Error('Manual QA draft revision conflict; reload the latest state.')
    Object.assign(error, { code: 'MANUAL_QA_DRAFT_CONFLICT', latest: latest ?? { data: null, revision: 0 } })
    throw error
  }
  return latest
}

function toCanonicalDraft(input: {
  raw: unknown
  ticketExternalId: string
  ticketDir: string
  version: number
  checklistHash: string
  revision: number
}) {
  const direct = ManualQaDraftSchema.safeParse(input.raw)
  if (direct.success) return direct.data
  const raw = input.raw && typeof input.raw === 'object' && !Array.isArray(input.raw) ? input.raw as Record<string, unknown> : {}
  const resultRecord = raw.results && typeof raw.results === 'object' && !Array.isArray(raw.results)
    ? raw.results as Record<string, unknown>
    : {}
  const improvements: Array<{ id: string; itemId: string; title: string; description: string; evidenceIds: string[] }> = []
  const results = Object.entries(resultRecord).map(([itemId, rawValue]) => {
    const value = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue as Record<string, unknown> : {}
    const improvement = value.improvement && typeof value.improvement === 'object' && !Array.isArray(value.improvement)
      ? value.improvement as Record<string, unknown>
      : null
    const improvementDraftId = improvement ? `improvement-${itemId.replace(/[^A-Za-z0-9._:-]/g, '_')}` : undefined
    if (improvement && improvementDraftId) {
      improvements.push({
        id: improvementDraftId,
        itemId,
        title: String(improvement.title ?? '').trim(),
        description: String(improvement.description ?? '').trim(),
        evidenceIds: Array.isArray(improvement.evidenceIds) ? improvement.evidenceIds.map(String) : [],
      })
    }
    return {
      itemId,
      outcome: String(value.status ?? value.outcome ?? 'pending'),
      note: String(value.note ?? ''),
      observation: String(value.observation ?? ''),
      reason: String(value.waiverReason ?? value.reason ?? ''),
      evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.map(String) : [],
      links: Array.isArray(value.links) ? value.links : [],
      ...(improvementDraftId ? { improvementDraftId } : {}),
      ...(typeof value.mergeGroup === 'string' && value.mergeGroup ? { mergeGroupId: value.mergeGroup } : {}),
    }
  })
  return ManualQaDraftSchema.parse({
    schemaVersion: 1,
    artifact: 'manual_qa_draft',
    ticketId: input.ticketExternalId,
    version: input.version,
    checklistHash: input.checklistHash,
    draftRevision: input.revision,
    results,
    improvements,
    evidence: readManualQaEvidenceIndex(input.ticketDir, input.version),
    updatedAt: new Date().toISOString(),
  })
}

function requireWaitingStatus(c: Context, ticket: { status: string }) {
  return ticket.status === 'WAITING_MANUAL_QA'
    ? null
    : c.json({ error: 'Manual QA mutations are only available while waiting for Manual QA.' }, 409)
}

function parseMutationHeaders(c: Context) {
  const actionId = c.req.header('X-Action-Id')?.trim() ?? c.req.query('actionId')?.trim() ?? ''
  const expectedChecklistHash = c.req.header('X-Checklist-Hash')?.trim() ?? c.req.query('expectedChecklistHash')?.trim() ?? ''
  const revisionRaw = c.req.header('X-Draft-Revision') ?? c.req.query('expectedDraftRevision')
  const expectedDraftRevision = Number(revisionRaw)
  if (!actionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(actionId)) throw new Error('A valid action ID is required.')
  if (!/^[a-f0-9]{64}$/.test(expectedChecklistHash)) throw new Error('A valid expected checklist hash is required.')
  if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new Error('A valid expected draft revision is required.')
  return { actionId, expectedChecklistHash, expectedDraftRevision }
}

function assertChecklistHash(ticketDir: string, version: number, expected: string): void {
  if (getManualQaChecklistHash(ticketDir, version) !== expected) {
    throw new Error('Manual QA checklist changed; reload before mutating evidence.')
  }
}

function manualQaError(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const drift = error && typeof error === 'object' && 'drift' in error ? (error as { drift: unknown }).drift : undefined
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
  if (code === 'MANUAL_QA_DRAFT_CONFLICT') {
    return c.json({ error: message, code, latest: (error as { latest?: unknown }).latest }, 409)
  }
  if (code === 'MANUAL_QA_WORKSPACE_DRIFT') return c.json({ error: message, code, drift }, 409)
  if (/not found/i.test(message)) return c.json({ error: message }, 404)
  if (/changed|revision|only available|already exists|requires|invalid|unknown|missing|must be/i.test(message)) {
    return c.json({ error: message }, 409)
  }
  return c.json({ error: message }, 400)
}

export function handleGetManualQa(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  try {
    return c.json(buildManualQaProjection(resolved.ticketId))
  } catch (error) {
    return manualQaError(c, error)
  }
}

export function handleGetManualQaVersion(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  try {
    const version = parseVersion(c)
    const detail = getManualQaVersionDetail(resolved.paths.ticketDir, version)
    if (!detail.checklist) return c.json({ error: 'Manual QA version not found' }, 404)
    const draftState = readManualQaDraftState(resolved.ticketId, version)
    const workspaceDrift = resolved.ticket.status === 'WAITING_MANUAL_QA'
      ? detectManualQaWorkspaceDrift(resolved.ticketId, version)
      : null
    const operationPath = getManualQaStoragePaths(resolved.paths.ticketDir, version).operationPath
    const operation = existsSync(operationPath) ? JSON.parse(readFileSync(operationPath, 'utf8')) : null
    return c.json({
      ...detail,
      version,
      status: detail.summary ? 'completed' : resolved.ticket.status === 'GENERATING_QA_CHECKLIST' ? 'generating' : 'waiting',
      draft: draftState?.data ?? detail.results,
      draftRevision: draftState?.revision ?? detail.results?.draftRevision ?? 0,
      readOnly: Boolean(detail.summary) || resolved.ticket.status !== 'WAITING_MANUAL_QA',
      workspaceDrift: workspaceDrift ? { detected: workspaceDrift.drifted, decisionRequired: workspaceDrift.drifted, files: workspaceDrift.files } : null,
      operation,
    })
  } catch (error) {
    return manualQaError(c, error)
  }
}

export async function handleUploadManualQaEvidence(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  const conflict = requireWaitingStatus(c, resolved.ticket)
  if (conflict) return conflict
  try {
    const version = parseVersion(c)
    const guard = parseMutationHeaders(c)
    assertChecklistHash(resolved.paths.ticketDir, version, guard.expectedChecklistHash)
    assertServerDraftRevision(resolved.ticketId, version, guard.expectedDraftRevision)
    const previousReceipt = readManualQaEvidenceActionReceipt(resolved.paths.ticketDir, version, guard.actionId)
    if (previousReceipt) return c.json({ evidence: previousReceipt.evidence, expectedDraftRevision: guard.expectedDraftRevision }, 200)
    const itemId = c.req.query('itemId')?.trim() ?? c.req.header('X-Checklist-Item-Id')?.trim() ?? ''
    const encodedName = c.req.header('X-File-Name') ?? c.req.query('fileName') ?? 'evidence'
    let originalName = encodedName
    try { originalName = decodeURIComponent(encodedName) } catch { /* keep the sanitized raw header */ }
    const evidenceId = c.req.header('X-Evidence-Id')?.trim() || randomUUID()
    const contentLength = Number(c.req.header('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_MANUAL_QA_EVIDENCE_BYTES) {
      return c.json({ error: `Evidence file exceeds ${MAX_MANUAL_QA_EVIDENCE_BYTES} bytes.` }, 413)
    }
    const metadata = await streamManualQaEvidence({
      ticketDir: resolved.paths.ticketDir,
      version,
      itemId,
      evidenceId,
      originalName,
      mediaType: c.req.header('Content-Type') ?? 'application/octet-stream',
      body: c.req.raw.body,
    })
    persistManualQaEvidenceActionReceipt(resolved.paths.ticketDir, version, guard.actionId, 'upload', metadata)
    return c.json({ evidence: metadata, expectedDraftRevision: guard.expectedDraftRevision }, 201)
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds')) return c.json({ error: error.message }, 413)
    return manualQaError(c, error)
  }
}

export function handleReadManualQaEvidence(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  try {
    const found = resolveManualQaEvidence({
      ticketDir: resolved.paths.ticketDir,
      version: parseVersion(c),
      itemId: getRequiredRouteParam(c, 'itemId'),
      evidenceId: getRequiredRouteParam(c, 'evidenceId'),
    })
    const inline = c.req.query('inline') === 'true' && isSafeRasterMediaType(found.metadata.mediaType)
    const filename = found.metadata.originalName.replace(/["\r\n]/g, '_')
    const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream<Uint8Array>
    return new Response(body, {
      headers: {
        'Content-Type': found.metadata.mediaType,
        'Content-Length': String(found.metadata.size),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return manualQaError(c, error)
  }
}

export async function handleRemoveManualQaEvidence(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  const conflict = requireWaitingStatus(c, resolved.ticket)
  if (conflict) return conflict
  try {
    const version = parseVersion(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const guard = Object.keys(body).length > 0 ? {
      actionId: String(body.actionId ?? ''),
      expectedChecklistHash: String(body.expectedChecklistHash ?? ''),
      expectedDraftRevision: Number(body.expectedDraftRevision),
    } : parseMutationHeaders(c)
    assertChecklistHash(resolved.paths.ticketDir, version, guard.expectedChecklistHash)
    assertServerDraftRevision(resolved.ticketId, version, guard.expectedDraftRevision)
    const previousReceipt = readManualQaEvidenceActionReceipt(resolved.paths.ticketDir, version, guard.actionId)
    if (previousReceipt) return c.json({ success: true, removed: previousReceipt.evidence, expectedDraftRevision: guard.expectedDraftRevision })
    const evidence = removeManualQaEvidence({
      ticketDir: resolved.paths.ticketDir,
      version,
      itemId: getRequiredRouteParam(c, 'itemId'),
      evidenceId: getRequiredRouteParam(c, 'evidenceId'),
    })
    persistManualQaEvidenceActionReceipt(resolved.paths.ticketDir, version, guard.actionId, 'remove', evidence)
    return c.json({ success: true, removed: evidence, expectedDraftRevision: guard.expectedDraftRevision })
  } catch (error) {
    return manualQaError(c, error)
  }
}

export async function handleSubmitManualQa(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  const conflict = requireWaitingStatus(c, resolved.ticket)
  if (conflict) return conflict
  try {
    const body = await c.req.json() as Record<string, unknown>
    const version = Number(body.version)
    const guard = {
      actionId: String(body.actionId ?? ''),
      expectedChecklistHash: String(body.expectedChecklistHash ?? ''),
      expectedDraftRevision: Number(body.expectedDraftRevision),
    }
    const latest = assertServerDraftRevision(resolved.ticketId, version, guard.expectedDraftRevision)
    const draft = toCanonicalDraft({
      // Submission snapshots the server-owned autosave revision. Never accept a
      // parallel client draft that could diverge while reusing the same guard.
      raw: latest?.data,
      ticketExternalId: resolved.ticket.externalId,
      ticketDir: resolved.paths.ticketDir,
      version,
      checklistHash: guard.expectedChecklistHash,
      revision: guard.expectedDraftRevision,
    })
    ensureActorForTicket(resolved.ticketId)
    const summary = await submitManualQa({
      ticketId: resolved.ticketId,
      version,
      draft,
      guard,
      sendEvent: (event) => sendTicketEvent(resolved.ticketId, event),
    })
    return c.json({ ...getManualQaVersionDetail(resolved.paths.ticketDir, version), version, status: summary.outcome, readOnly: true, summary })
  } catch (error) {
    return manualQaError(c, error)
  }
}

export async function handleSkipManualQa(c: Context) {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  const conflict = requireWaitingStatus(c, resolved.ticket)
  if (conflict) return conflict
  try {
    const body = await c.req.json() as Record<string, unknown>
    const version = Number(body.version)
    const expectedChecklistHash = String(body.expectedChecklistHash ?? '')
    const expectedDraftRevision = Number(body.expectedDraftRevision)
    const latest = assertServerDraftRevision(resolved.ticketId, version, expectedDraftRevision)
    const savedDraft = latest?.data && typeof latest.data === 'object' && !Array.isArray(latest.data)
      ? latest.data as Record<string, unknown>
      : {}
    const draft = toCanonicalDraft({
      raw: savedDraft,
      ticketExternalId: resolved.ticket.externalId,
      ticketDir: resolved.paths.ticketDir,
      version,
      checklistHash: expectedChecklistHash,
      revision: expectedDraftRevision,
    })
    ensureActorForTicket(resolved.ticketId)
    const summary = await skipManualQa({
      ticketId: resolved.ticketId,
      version,
      draft,
      guard: {
        actionId: String(body.actionId ?? ''),
        expectedChecklistHash,
        expectedDraftRevision,
      },
      reason: typeof savedDraft.skipReason === 'string'
        ? savedDraft.skipReason
        : undefined,
      sendEvent: (event) => sendTicketEvent(resolved.ticketId, event),
    })
    return c.json({ ...getManualQaVersionDetail(resolved.paths.ticketDir, version), version, status: 'skipped', readOnly: true, summary })
  } catch (error) {
    return manualQaError(c, error)
  }
}

async function handleManualQaDriftDecision(c: Context, decision: 'include' | 'discard') {
  const resolved = requireTicket(c)
  if (!resolved) return c.json({ error: 'Ticket not found' }, 404)
  const conflict = requireWaitingStatus(c, resolved.ticket)
  if (conflict) return conflict
  try {
    const body = await c.req.json() as Record<string, unknown>
    const version = Number(body.version)
    const actionId = String(body.actionId ?? '')
    const expectedChecklistHash = String(body.expectedChecklistHash ?? '')
    const expectedDraftRevision = Number(body.expectedDraftRevision)
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new Error('A valid expected draft revision is required.')
    assertChecklistHash(resolved.paths.ticketDir, version, expectedChecklistHash)
    assertServerDraftRevision(resolved.ticketId, version, expectedDraftRevision)
    const currentDrift = detectManualQaWorkspaceDrift(resolved.ticketId, version)
    const files = Array.isArray(body.files)
      ? body.files.filter((entry): entry is string => typeof entry === 'string')
      : currentDrift.files.map((entry) => entry.path)
    const receipt = decision === 'include'
      ? includeManualQaWorkspaceDrift(resolved.ticketId, version, files, actionId)
      : discardManualQaWorkspaceDrift(resolved.ticketId, version, files, actionId)
    return c.json({ ...getManualQaVersionDetail(resolved.paths.ticketDir, version), version, status: 'waiting', workspaceDrift: { detected: false, files: [] }, operation: { status: 'drift_resolved', receipt } })
  } catch (error) {
    return manualQaError(c, error)
  }
}

export function handleIncludeManualQaDrift(c: Context) {
  return handleManualQaDriftDecision(c, 'include')
}

export function handleDiscardManualQaDrift(c: Context) {
  return handleManualQaDriftDecision(c, 'discard')
}
