import type { Context } from 'hono'
import { getTicketByRef } from '../../storage/tickets'
import {
  readExecutionSetupPlan,
  saveExecutionSetupPlan,
  saveExecutionSetupPlanRawContent,
} from '../../phases/executionSetupPlan/document'
import { regenerateExecutionSetupPlanDraft } from '../../workflow/phases/executionSetupPlanPhase'
import { normalizeExecutionSetupPlanOutput } from '../../structuredOutput'
import { getErrorMessage } from '@shared/typeGuards'
import {
  emitRoutePhaseLog,
  getMachineContext,
  getTicketParam,
  prepareExecutionSetupPlanRestart,
} from './routeUtils'
import {
  rawExecutionSetupPlanSaveSchema,
  regenerateExecutionSetupPlanSchema,
  structuredExecutionSetupPlanSaveSchema,
} from './schemas'

export function handleGetExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  const phaseAttemptParam = c.req.query('phaseAttempt')
  const phaseAttempt = phaseAttemptParam ? parseInt(phaseAttemptParam, 10) : undefined

  try {
    const current = readExecutionSetupPlan(ticketId, phaseAttempt)
    return c.json({
      exists: Boolean(current.plan),
      artifactId: current.artifactId,
      updatedAt: current.updatedAt,
      raw: current.raw,
      plan: current.plan,
    })
  } catch (err) {
    return c.json({
      error: 'Failed to read execution setup plan',
      details: getErrorMessage(err),
    }, 400)
  }
}

export async function handlePutExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const rawParsed = rawExecutionSetupPlanSaveSchema.safeParse(body)
  if (rawParsed.success) {
    try {
      const { raw, plan } = saveExecutionSetupPlanRawContent(ticketId, rawParsed.data.content)
      return c.json({ success: true, raw, plan })
    } catch (err) {
      return c.json({
        error: 'Failed to save execution setup plan',
        details: getErrorMessage(err),
      }, 400)
    }
  }

  const structuredParsed = structuredExecutionSetupPlanSaveSchema.safeParse(body)
  if (!structuredParsed.success) {
    return c.json({ error: 'Invalid execution setup plan payload', details: structuredParsed.error.flatten() }, 400)
  }

  try {
    const { raw, plan } = saveExecutionSetupPlan(ticketId, structuredParsed.data.plan)
    return c.json({ success: true, raw, plan })
  } catch (err) {
    return c.json({
      error: 'Failed to save execution setup plan',
      details: getErrorMessage(err),
    }, 400)
  }
}

export async function handleRegenerateExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = regenerateExecutionSetupPlanSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid regenerate payload', details: parsed.error.flatten() }, 400)
  }

  // Read current plan before archiving (for context in background generation)
  let currentPlan = parsed.data.plan ?? null
  if (!currentPlan && parsed.data.rawContent) {
    const normalized = normalizeExecutionSetupPlanOutput(parsed.data.rawContent)
    if (!normalized.ok) {
      return c.json({ error: 'Invalid raw setup plan draft', details: normalized.error }, 400)
    }
    currentPlan = normalized.value
  }
  if (!currentPlan) {
    currentPlan = readExecutionSetupPlan(ticketId).plan
  }

  const machineContext = getMachineContext(ticketId)

  // Archive old attempt, create new empty attempt
  await prepareExecutionSetupPlanRestart(ticketId)

  // Fire-and-forget: generate new plan in background with commentary + old plan context
  void regenerateExecutionSetupPlanDraft({
    ticketId,
    context: machineContext,
    commentary: parsed.data.commentary,
    currentPlan,
  }).catch((err: unknown) => {
    const errMsg = getErrorMessage(err)
    emitRoutePhaseLog(ticketId, 'WAITING_EXECUTION_SETUP_APPROVAL', 'error', `Background regeneration failed: ${errMsg}`)
  })

  return c.json({ success: true })
}
