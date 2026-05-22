import type { Context } from 'hono'
import type { TicketContext as MachineTicketContext } from '../../machines/types'
import { db as appDb } from '../../db/index'
import { profiles } from '../../db/schema'
import {
  ensureActorForTicket,
  getTicketState,
  revertTicketToApprovalStatus,
} from '../../machines/persistence'
import { abortTicketSessions } from '../../opencode/sessionManager'
import { clearContextCache } from '../../opencode/contextBuilder'
import { broadcaster } from '../../sse/broadcaster'
import { appendLogEvent, shouldSkipLogEmission } from '../../log/executionLog'
import { cancelTicket } from '../../workflow/runner'
import {
  archiveActivePhaseAttempts,
  createFreshPhaseAttempts,
  ensureActivePhaseAttempt,
  EXECUTION_SETUP_PLAN_RESTART_PHASES,
  getTicketByRef,
  INTERVIEW_EDIT_RESTART_PHASES,
  PRD_EDIT_RESTART_PHASES,
} from '../../storage/tickets'

export function getProfileDefaults() {
  return appDb.select().from(profiles).get()
}

export function respondWithState(c: Context, ticketId: string, message: string) {
  const updated = getTicketByRef(ticketId)
  const state = getTicketState(ticketId)
  return c.json({
    message,
    ticketId,
    status: state?.state ?? updated?.status,
    state: state?.state,
    ...(updated ? { ticket: updated } : {}),
  })
}

export function buildRouteStatePayload(ticketId: string) {
  const updated = getTicketByRef(ticketId)
  const state = getTicketState(ticketId)
  return {
    status: state?.state ?? updated?.status,
    state: state?.state,
    ...(updated ? { ticket: updated } : {}),
  }
}

export function emitRoutePhaseLog(
  ticketId: string,
  phase: string,
  type: 'info' | 'error',
  content: string,
  data?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString()
  const source = type === 'error' ? 'error' : 'system'
  const kind = type === 'error' ? 'error' : 'milestone'
  const payload = {
    ticketId,
    phase,
    type,
    content,
    source,
    audience: 'all' as const,
    kind,
    op: 'append' as const,
    streaming: false,
    timestamp,
    ...(data ?? {}),
  }
  const emissionData = data ? { ticketId, ...data, timestamp } : { ticketId, timestamp }
  if (shouldSkipLogEmission(ticketId, type, phase, content, emissionData, source, phase, {
    audience: 'all',
    kind,
    op: 'append',
    streaming: false,
  })) {
    return
  }

  broadcaster.broadcast(ticketId, 'log', payload)
  appendLogEvent(
    ticketId,
    type,
    phase,
    content,
    emissionData,
    source,
    phase,
    {
      audience: 'all',
      kind,
      op: 'append',
      streaming: false,
    },
  )
}

export function getTicketParam(c: Context): string {
  const ticketId = c.req.param('id') ?? c.req.param('ticketId')
  if (!ticketId) {
    throw new Error('Ticket route is missing the required id parameter')
  }
  return ticketId
}

export function getRequiredRouteParam(c: Context, name: string): string {
  const value = c.req.param(name)
  if (!value) {
    throw new Error(`Route is missing required parameter "${name}"`)
  }
  return value
}

export function getMachineContext(ticketId: string): MachineTicketContext {
  ensureActorForTicket(ticketId)
  const state = getTicketState(ticketId)
  if (!state) {
    throw new Error('Ticket actor state is unavailable')
  }
  return state.context as MachineTicketContext
}

export function buildExecutionBandConflictMessage(conflict: {
  externalId: string
  title: string
  status: string
}) {
  return `Project execution is busy with ${conflict.externalId} (${conflict.status}): ${conflict.title}`
}

export async function preparePlanningRestart(
  ticketId: string,
  targetApprovalStatus: 'WAITING_INTERVIEW_APPROVAL' | 'WAITING_PRD_APPROVAL',
): Promise<void> {
  const restartPhase = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? 'WAITING_INTERVIEW_APPROVAL'
    : 'WAITING_PRD_APPROVAL'
  const restartReason = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? 'interview_edit_restart'
    : 'prd_edit_restart'
  const phasesToArchive = targetApprovalStatus === 'WAITING_INTERVIEW_APPROVAL'
    ? INTERVIEW_EDIT_RESTART_PHASES
    : PRD_EDIT_RESTART_PHASES

  emitRoutePhaseLog(ticketId, restartPhase, 'info', 'Archiving downstream planning attempts and aborting active downstream work.')
  cancelTicket(ticketId)
  await abortTicketSessions(ticketId)
  clearContextCache(ticketId)
  ensureActivePhaseAttempt(ticketId, targetApprovalStatus)
  archiveActivePhaseAttempts(ticketId, phasesToArchive, restartReason)
  createFreshPhaseAttempts(ticketId, phasesToArchive)

  ensureActorForTicket(ticketId)
  revertTicketToApprovalStatus(ticketId, targetApprovalStatus)
}

export async function prepareExecutionSetupPlanRestart(ticketId: string): Promise<void> {
  emitRoutePhaseLog(ticketId, 'WAITING_EXECUTION_SETUP_APPROVAL', 'info', 'Archiving current execution setup plan attempt for versioned regenerate.')
  cancelTicket(ticketId)
  await abortTicketSessions(ticketId)
  clearContextCache(ticketId)
  ensureActivePhaseAttempt(ticketId, 'WAITING_EXECUTION_SETUP_APPROVAL')
  archiveActivePhaseAttempts(ticketId, EXECUTION_SETUP_PLAN_RESTART_PHASES, 'execution_setup_plan_regenerate')
  createFreshPhaseAttempts(ticketId, EXECUTION_SETUP_PLAN_RESTART_PHASES)
  ensureActorForTicket(ticketId)
}
