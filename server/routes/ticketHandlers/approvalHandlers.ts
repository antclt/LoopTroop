import type { Context } from 'hono'
import { ensureActorForTicket, sendTicketEvent } from '../../machines/persistence'
import {
  findProjectExecutionBandConflict,
  getTicketByRef,
} from '../../storage/tickets'
import { approveInterviewDocument } from '../../phases/interview/finalDocument'
import {
  approvePrdDocument,
  buildDraftPrdDocumentFromRawContent,
  buildDraftPrdDocumentFromStructuredContent,
  saveApprovedPrdDocument,
  savePrdDocument,
} from '../../phases/prd/document'
import { approveBeadsDocument } from '../../phases/beads/document'
import {
  approveExecutionSetupPlan,
  readExecutionSetupPlan,
} from '../../phases/executionSetupPlan/document'
import type { ExecutionSetupPlan } from '../../phases/executionSetupPlan/types'
import type { PrdDocument } from '../../structuredOutput/types'
import { isBeforeExecution, isStatusAtOrPast } from '@shared/workflowMeta'
import { getErrorMessage } from '@shared/typeGuards'
import {
  buildExecutionBandConflictMessage,
  buildRouteStatePayload,
  emitRoutePhaseLog,
  getTicketParam,
  preparePlanningRestart,
  respondWithState,
} from './routeUtils'
import { rawPrdSaveSchema, structuredPrdSaveSchema } from './schemas'

export function handleApproveTicket(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const approvalStates = ['WAITING_INTERVIEW_APPROVAL', 'WAITING_PRD_APPROVAL', 'WAITING_BEADS_APPROVAL', 'WAITING_EXECUTION_SETUP_APPROVAL']
  if (!approvalStates.includes(ticket.status)) {
    return c.json({ error: 'Ticket is not in an approval state' }, 409)
  }

  if (ticket.status === 'WAITING_INTERVIEW_APPROVAL') {
    return handleApproveInterview(c)
  }
  if (ticket.status === 'WAITING_PRD_APPROVAL') {
    return handleApprovePrd(c)
  }
  if (ticket.status === 'WAITING_BEADS_APPROVAL') {
    return handleApproveBeads(c)
  }
  if (ticket.status === 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return handleApproveExecutionSetupPlan(c)
  }

  try {
    ensureActorForTicket(ticketId)
    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to send APPROVE to ticket ${ticketId}:`, err)
    return c.json({ error: 'Failed to approve ticket', details: String(err) }, 500)
  }

  return respondWithState(c, ticketId, 'Approve action accepted')
}

export async function handlePutPrd(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (!isStatusAtOrPast(ticket.status, 'WAITING_PRD_APPROVAL') || !isBeforeExecution(ticket.status, ticket.previousStatus)) {
    return c.json({ error: 'Ticket is not in a state where PRD can be edited' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const rawParsed = rawPrdSaveSchema.safeParse(body)
  if (rawParsed.success) {
    let document: PrdDocument
    try {
      document = buildDraftPrdDocumentFromRawContent(ticketId, rawParsed.data.content)
    } catch (err) {
      return c.json({
        error: 'Failed to save PRD document',
        details: getErrorMessage(err),
      }, 400)
    }

    try {
      if (ticket.status !== 'WAITING_PRD_APPROVAL') {
        await preparePlanningRestart(ticketId, 'WAITING_PRD_APPROVAL')
        const { raw } = saveApprovedPrdDocument(ticketId, document)
        emitRoutePhaseLog(ticketId, 'WAITING_PRD_APPROVAL', 'info', 'PRD edit saved and approved. Restarting Beads planning from the edited PRD.')
        sendTicketEvent(ticketId, { type: 'APPROVE' })
        return c.json({
          success: true,
          content: raw,
          ...buildRouteStatePayload(ticketId),
        })
      }
      const { raw } = savePrdDocument(ticketId, document)
      return c.json({
        success: true,
        content: raw,
        ...buildRouteStatePayload(ticketId),
      })
    } catch (err) {
      return c.json({
        error: 'Failed to save PRD document',
        details: getErrorMessage(err),
      }, 400)
    }
  }

  const structuredParsed = structuredPrdSaveSchema.safeParse(body)
  if (!structuredParsed.success) {
    return c.json({ error: 'Invalid PRD document payload', details: structuredParsed.error.flatten() }, 400)
  }

  let document: PrdDocument
  try {
    document = buildDraftPrdDocumentFromStructuredContent(ticketId, structuredParsed.data.document)
  } catch (err) {
    return c.json({
      error: 'Failed to save PRD document',
      details: getErrorMessage(err),
    }, 400)
  }

  try {
    if (ticket.status !== 'WAITING_PRD_APPROVAL') {
      await preparePlanningRestart(ticketId, 'WAITING_PRD_APPROVAL')
      const { raw } = saveApprovedPrdDocument(ticketId, document)
      emitRoutePhaseLog(ticketId, 'WAITING_PRD_APPROVAL', 'info', 'PRD edit saved and approved. Restarting Beads planning from the edited PRD.')
      sendTicketEvent(ticketId, { type: 'APPROVE' })
      return c.json({
        success: true,
        content: raw,
        ...buildRouteStatePayload(ticketId),
      })
    }
    const { raw } = savePrdDocument(ticketId, document)
    return c.json({
      success: true,
      content: raw,
      ...buildRouteStatePayload(ticketId),
    })
  } catch (err) {
    return c.json({
      error: 'Failed to save PRD document',
      details: getErrorMessage(err),
    }, 400)
  }
}

export function handleApproveInterview(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_INTERVIEW_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for interview approval' }, 409)
  }

  try {
    approveInterviewDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_INTERVIEW_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'Interview approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve interview for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve interview',
      details: getErrorMessage(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Interview approved')
}

export function handleApprovePrd(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_PRD_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for PRD approval' }, 409)
  }

  try {
    approvePrdDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_PRD_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'PRD approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve PRD for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve PRD',
      details: getErrorMessage(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'PRD approved')
}

export function handleApproveBeads(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_BEADS_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for beads approval' }, 409)
  }

  const executionConflict = findProjectExecutionBandConflict(ticket.projectId, ticket.id)
  if (executionConflict) {
    return c.json({ error: buildExecutionBandConflictMessage(executionConflict) }, 409)
  }

  try {
    approveBeadsDocument(ticketId)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_BEADS_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'Beads approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE' })
  } catch (err) {
    console.error(`[tickets] Failed to approve beads for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve beads',
      details: getErrorMessage(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Beads approved')
}

export function handleApproveExecutionSetupPlan(c: Context) {
  const ticketId = getTicketParam(c)
  const ticket = getTicketByRef(ticketId)
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)
  if (ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL') {
    return c.json({ error: 'Ticket is not waiting for execution setup plan approval' }, 409)
  }

  const executionConflict = findProjectExecutionBandConflict(ticket.projectId, ticket.id)
  if (executionConflict) {
    return c.json({ error: buildExecutionBandConflictMessage(executionConflict) }, 409)
  }

  let plan: ExecutionSetupPlan | null = null
  try {
    plan = readExecutionSetupPlan(ticketId).plan
    if (!plan) {
      return c.json({ error: 'Execution setup plan is not ready yet' }, 409)
    }

    approveExecutionSetupPlan(ticketId, plan)
    ensureActorForTicket(ticketId)

    const phase = 'WAITING_EXECUTION_SETUP_APPROVAL'
    emitRoutePhaseLog(ticketId, phase, 'info', 'Execution setup plan approved by user.')

    sendTicketEvent(ticketId, { type: 'APPROVE_EXECUTION_SETUP_PLAN' })
  } catch (err) {
    console.error(`[tickets] Failed to approve execution setup plan for ${ticketId}:`, err)
    return c.json({
      error: 'Failed to approve execution setup plan',
      details: getErrorMessage(err),
    }, 500)
  }

  return respondWithState(c, ticketId, 'Execution setup plan approved')
}
