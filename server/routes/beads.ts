import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getTicketByRef, getTicketPaths, getLatestPhaseArtifact } from '../storage/tickets'
import { safeAtomicWrite } from '../io/atomicWrite'
import { syncTicketRuntimeProjection } from '../storage/ticketRuntimeProjection'
import { clearExecutionSetupState } from '../phases/executionSetup/storage'
import { upsertBeadsApprovalSnapshot } from '../phases/beads/document'

const beadsRouter = new Hono()
const FLOW_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/

function isSafeFlowName(flow: string): boolean {
  if (!flow || path.isAbsolute(flow) || flow.includes('\\') || !FLOW_NAME_PATTERN.test(flow)) return false
  return flow.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

function resolveBeadsPath(ticketId: string, flow?: string): { filePath: string } | { error: string; status: 400 | 404 } {
  const paths = getTicketPaths(ticketId)
  if (!paths) return { error: 'Ticket not found', status: 404 }
  const resolvedFlow = flow?.trim() || paths.baseBranch
  if (!isSafeFlowName(resolvedFlow)) {
    return { error: 'Invalid flow parameter', status: 400 }
  }

  const beadsRoot = path.resolve(paths.ticketDir, 'beads')
  const filePath = path.resolve(beadsRoot, resolvedFlow, '.beads', 'issues.jsonl')
  const relativePath = path.relative(beadsRoot, filePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { error: 'Invalid flow parameter', status: 400 }
  }

  return { filePath }
}

beadsRouter.get('/tickets/:id/beads', (c) => {
  const ticketId = c.req.param('id')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow')
  const resolved = resolveBeadsPath(ticketId, flow)
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status)
  const { filePath } = resolved

  if (!fs.existsSync(filePath)) {
    return c.json([])
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter((line) => line.trim() !== '')
  try {
    const beads = lines.map((line) => JSON.parse(line))
    return c.json(beads)
  } catch {
    return c.json({ error: 'Corrupted JSONL data' }, 500)
  }
})

beadsRouter.put('/tickets/:id/beads', async (c) => {
  const ticketId = c.req.param('id')
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const flow = c.req.query('flow')
  const body = await c.req.json()
  if (!Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON array' }, 400)
  }

  const resolved = resolveBeadsPath(ticketId, flow)
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status)
  const { filePath } = resolved

  try {
    const jsonl = body.map((item: unknown) => JSON.stringify(item)).join('\n') + '\n'
    safeAtomicWrite(filePath, jsonl)
    upsertBeadsApprovalSnapshot(ticketId, jsonl)
    clearExecutionSetupState(ticketId)
    syncTicketRuntimeProjection(ticketId)
  } catch {
    return c.json({ error: 'Failed to write file' }, 500)
  }

  return c.json({ success: true })
})

const BEAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/

beadsRouter.get('/tickets/:id/beads/:beadId/diff', (c) => {
  const ticketId = c.req.param('id')
  const beadId = c.req.param('beadId')

  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)
  if (!beadId || !BEAD_ID_PATTERN.test(beadId)) {
    return c.json({ error: 'Invalid bead ID' }, 400)
  }

  const artifact = getLatestPhaseArtifact(ticketId, `bead_diff:${beadId}`, 'CODING')
  if (!artifact) {
    return c.json({ diff: '', captured: false })
  }

  return c.json({ diff: artifact.content ?? '', captured: true })
})

export { beadsRouter }
