import type { Context } from 'hono'
import { getTicketByRef } from '../../storage/tickets'
import { ArchivedArtifactWriteError, assertCurrentEditablePhaseAttempt } from '../../storage/ticketPhaseAttempts'
import {
  readExecutionSetupPlan,
  saveExecutionSetupPlan,
  saveExecutionSetupPlanRawContent,
} from '../../phases/executionSetupPlan/document'
import {
  EXECUTION_SETUP_PLAN_RESULT_END,
  EXECUTION_SETUP_PLAN_RESULT_MARKER,
  serializeExecutionSetupPlan,
} from '../../phases/executionSetupPlan/types'
import { regenerateExecutionSetupPlanDraft } from '../../workflow/phases/executionSetupPlanPhase'
import { normalizeExecutionSetupPlanOutput } from '../../structuredOutput'
import { getErrorMessage } from '@shared/typeGuards'
import { writeUserEditReceipt } from '../../workflow/artifactEditReceipts'
import {
  buildRouteStatePayload,
  emitRoutePhaseLog,
  getMachineContext,
  getTicketParam,
  prepareExecutionSetupPlanRestart,
  prepareExecutionSetupRuntimeRewind,
} from './routeUtils'
import {
  rawExecutionSetupPlanSaveSchema,
  regenerateExecutionSetupPlanSchema,
  structuredExecutionSetupPlanSaveSchema,
} from './schemas'

function countPlanCommands(plan: { steps: Array<{ commands: unknown[] }> } | null): number | null {
  return plan ? plan.steps.reduce((sum, step) => sum + step.commands.length, 0) : null
}

function isEditableExecutionSetupPlanStatus(status: string): boolean {
  return status === 'WAITING_EXECUTION_SETUP_APPROVAL' || status === 'PREPARING_EXECUTION_ENV'
}

function shouldRewindRuntimeSetup(status: string): boolean {
  return status === 'PREPARING_EXECUTION_ENV'
}

function normalizeRawSetupPlanContent(rawContent: string) {
  const content = rawContent.includes(EXECUTION_SETUP_PLAN_RESULT_MARKER)
    ? rawContent
    : `${EXECUTION_SETUP_PLAN_RESULT_MARKER}\n${rawContent}\n${EXECUTION_SETUP_PLAN_RESULT_END}`
  return normalizeExecutionSetupPlanOutput(content)
}

function validateRawSetupPlanContent(rawContent: string): string | null {
  const normalized = normalizeRawSetupPlanContent(rawContent)
  return normalized.ok ? null : normalized.error
}

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
      contentSha256: current.contentSha256,
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
  if (!isEditableExecutionSetupPlanStatus(ticket.status)) {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval or preparing workspace runtime' }, 409)
  }
  const phaseAttemptParam = c.req.query('phaseAttempt')
  const rewindsRuntimeSetup = shouldRewindRuntimeSetup(ticket.status)
  if (rewindsRuntimeSetup && phaseAttemptParam != null) {
    return c.json({ error: 'Cannot write an explicit setup-plan version while rewinding workspace runtime setup' }, 409)
  }
  if (phaseAttemptParam != null) {
    const phaseAttempt = Number(phaseAttemptParam)
    if (!Number.isFinite(phaseAttempt) || phaseAttempt <= 0) {
      return c.json({ error: 'Invalid phaseAttempt parameter: must be a positive number' }, 400)
    }
    try {
      assertCurrentEditablePhaseAttempt({
        ticketId,
        phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
        requestedPhaseAttempt: phaseAttempt,
      })
    } catch (err) {
      if (err instanceof ArchivedArtifactWriteError) {
        return c.json({
          error: 'Archived artifact versions are read-only',
          phase: err.phase,
          requestedPhaseAttempt: err.requestedPhaseAttempt,
          activePhaseAttempt: err.activePhaseAttempt,
        }, 409)
      }
      throw err
    }
  }

  let beforeRaw: string | null = null
  let beforeCommandCount: number | null = null
  try {
    const before = readExecutionSetupPlan(ticketId)
    beforeRaw = before.raw
    beforeCommandCount = countPlanCommands(before.plan)
  } catch {
    beforeRaw = null
  }

  const body = await c.req.json().catch(() => ({}))
  const rawParsed = rawExecutionSetupPlanSaveSchema.safeParse(body)
  if (rawParsed.success) {
    const validationError = validateRawSetupPlanContent(rawParsed.data.content)
    if (validationError) {
      return c.json({
        error: 'Failed to save execution setup plan',
        details: validationError,
      }, 400)
    }

    try {
      const restart = rewindsRuntimeSetup ? await prepareExecutionSetupRuntimeRewind(ticketId) : null
      const { raw, contentSha256, plan } = saveExecutionSetupPlanRawContent(ticketId, rawParsed.data.content)
      writeUserEditReceipt({
        ticketId,
        artifactType: 'execution_setup_plan',
        phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
        action: rewindsRuntimeSetup ? 'save_and_rewind' : 'save',
        editSurface: 'raw',
        statusBeforeEdit: ticket.status,
        statusAfterEdit: getTicketByRef(ticketId)?.status ?? null,
        beforeRaw,
        afterRaw: raw,
        beforeItemCount: beforeCommandCount,
        afterItemCount: countPlanCommands(plan),
        restart,
      })
      return c.json({ success: true, raw, contentSha256, plan, ...buildRouteStatePayload(ticketId) })
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

  const validationError = validateRawSetupPlanContent(serializeExecutionSetupPlan(structuredParsed.data.plan))
  if (validationError) {
    return c.json({
      error: 'Failed to save execution setup plan',
      details: validationError,
    }, 400)
  }

  try {
    const restart = rewindsRuntimeSetup ? await prepareExecutionSetupRuntimeRewind(ticketId) : null
    const { raw, contentSha256, plan } = saveExecutionSetupPlan(ticketId, structuredParsed.data.plan)
    writeUserEditReceipt({
      ticketId,
      artifactType: 'execution_setup_plan',
      phase: 'WAITING_EXECUTION_SETUP_APPROVAL',
      action: rewindsRuntimeSetup ? 'save_and_rewind' : 'save',
      editSurface: 'structured',
      statusBeforeEdit: ticket.status,
      statusAfterEdit: getTicketByRef(ticketId)?.status ?? null,
      beforeRaw,
      afterRaw: raw,
      beforeItemCount: beforeCommandCount,
      afterItemCount: countPlanCommands(plan),
      restart,
    })
    return c.json({ success: true, raw, contentSha256, plan, ...buildRouteStatePayload(ticketId) })
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
  if (!isEditableExecutionSetupPlanStatus(ticket.status)) {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval or preparing workspace runtime' }, 409)
  }
  const rewindsRuntimeSetup = shouldRewindRuntimeSetup(ticket.status)

  const body = await c.req.json().catch(() => ({}))
  const parsed = regenerateExecutionSetupPlanSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid regenerate payload', details: parsed.error.flatten() }, 400)
  }

  // Read current plan before archiving (for context in background generation)
  let currentPlan = parsed.data.plan ?? null
  if (!currentPlan && parsed.data.rawContent) {
    const normalized = normalizeRawSetupPlanContent(parsed.data.rawContent)
    if (!normalized.ok) {
      return c.json({ error: 'Invalid raw setup plan draft', details: normalized.error }, 400)
    }
    currentPlan = normalized.value
  }
  if (!currentPlan) {
    currentPlan = readExecutionSetupPlan(ticketId).plan
  }

  // Archive old attempt, create new empty attempt
  if (rewindsRuntimeSetup) {
    await prepareExecutionSetupRuntimeRewind(ticketId)
  } else {
    await prepareExecutionSetupPlanRestart(ticketId)
  }

  const machineContext = getMachineContext(ticketId)

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

  return c.json({ success: true, ...buildRouteStatePayload(ticketId) })
}
