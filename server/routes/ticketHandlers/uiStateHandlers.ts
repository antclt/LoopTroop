import type { Context } from 'hono'
import { MAX_UI_STATE_BYTES } from '../../lib/constants'
import {
  getLatestPhaseArtifact,
  getTicketByRef,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { getTicketParam } from './routeUtils'
import { uiStateScopeSchema, upsertUiStateSchema } from './schemas'

const UI_STATE_PHASE = 'UI_STATE'
const UI_STATE_ARTIFACT_PREFIX = 'ui_state:'

function uiStateArtifactType(scope: string): string {
  return `${UI_STATE_ARTIFACT_PREFIX}${scope}`
}

function readUiState(ticketId: string, scope: string): { data: unknown; updatedAt: string | null; clientRevision: number | null } | null {
  const artifact = getLatestPhaseArtifact(ticketId, uiStateArtifactType(scope), UI_STATE_PHASE)
  if (!artifact) return null

  try {
    const parsed = JSON.parse(artifact.content) as { data?: unknown; updatedAt?: string | null; clientRevision?: unknown }
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return {
        data: parsed.data,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : artifact.createdAt,
        clientRevision: typeof parsed.clientRevision === 'number' && Number.isFinite(parsed.clientRevision)
          ? parsed.clientRevision
          : null,
      }
    }
    return { data: parsed, updatedAt: artifact.createdAt, clientRevision: null }
  } catch {
    return { data: null, updatedAt: artifact.createdAt, clientRevision: null }
  }
}

function upsertUiState(
  ticketId: string,
  scope: string,
  data: unknown,
  clientRevision?: number,
): { updatedAt: string; clientRevision: number | null; ignored: boolean } {
  const existing = readUiState(ticketId, scope)
  if (
    typeof clientRevision === 'number'
    && typeof existing?.clientRevision === 'number'
    && existing.clientRevision > clientRevision
  ) {
    return {
      updatedAt: existing.updatedAt ?? new Date().toISOString(),
      clientRevision: existing.clientRevision,
      ignored: true,
    }
  }

  const now = new Date().toISOString()
  const payload = JSON.stringify({ data, updatedAt: now, clientRevision: clientRevision ?? null })
  if (Buffer.byteLength(payload, 'utf8') > MAX_UI_STATE_BYTES) {
    throw new Error(`UI state payload exceeds ${MAX_UI_STATE_BYTES} bytes`)
  }

  upsertLatestPhaseArtifact(ticketId, uiStateArtifactType(scope), UI_STATE_PHASE, payload)
  return { updatedAt: now, clientRevision: clientRevision ?? null, ignored: false }
}

export function handleGetUiState(c: Context) {
  const ticketId = getTicketParam(c)
  const parsed = uiStateScopeSchema.safeParse({ scope: c.req.query('scope') ?? '' })
  if (!parsed.success) {
    return c.json({ error: 'Invalid scope', details: parsed.error.flatten() }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const state = readUiState(ticketId, parsed.data.scope)
  if (!state) {
    return c.json({
      scope: parsed.data.scope,
      exists: false,
      data: null,
      updatedAt: null,
      clientRevision: null,
    })
  }

  return c.json({
    scope: parsed.data.scope,
    exists: true,
    data: state.data,
    updatedAt: state.updatedAt,
    clientRevision: state.clientRevision,
  })
}

export async function handlePutUiState(c: Context) {
  const ticketId = getTicketParam(c)
  const body = await c.req.json().catch(() => ({}))
  const parsed = upsertUiStateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid UI state payload', details: parsed.error.flatten() }, 400)
  }

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const result = upsertUiState(ticketId, parsed.data.scope, parsed.data.data, parsed.data.clientRevision)
    return c.json({
      success: true,
      ignored: result.ignored,
      scope: parsed.data.scope,
      updatedAt: result.updatedAt,
      clientRevision: result.clientRevision,
    })
  } catch (err) {
    return c.json({ error: 'Failed to persist UI state', details: String(err) }, 500)
  }
}
