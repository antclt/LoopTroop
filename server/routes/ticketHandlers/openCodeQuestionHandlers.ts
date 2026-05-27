import type { Context } from 'hono'
import { buildOpenCodeQuestionLogIdentity, type OpenCodeQuestionLogAction } from '@shared/logIdentity'
import { listOpenCodeSessionsForTicket } from '../../opencode/sessionManager'
import { getOpenCodeAdapter } from '../../opencode/factory'
import { broadcaster } from '../../sse/broadcaster'
import { appendLogEvent, createLogEvent, shouldSkipLogEmission } from '../../log/executionLog'
import {
  getTicketByRef,
  getTicketContext,
  listNonTerminalTickets,
} from '../../storage/tickets'
import { getErrorMessage } from '@shared/typeGuards'
import {
  emitRoutePhaseLog,
  getRequiredRouteParam,
  getTicketParam,
} from './routeUtils'
import { opencodeQuestionReplySchema } from './schemas'

function emitOpenCodeQuestionLog(
  ticketId: string,
  phase: string,
  content: string,
  data: {
    requestId: string
    sessionId?: string
    modelId?: string
    phaseAttempt?: number
    kind?: 'session' | 'error'
    type?: 'info' | 'error'
    action: OpenCodeQuestionLogAction
  },
) {
  const timestamp = new Date().toISOString()
  const logType = data.type ?? (data.kind === 'error' ? 'error' : 'info')
  const source = data.kind === 'error' ? 'error' : data.modelId ? `model:${data.modelId}` as const : 'opencode'
  const identity = buildOpenCodeQuestionLogIdentity({
    sessionId: data.sessionId,
    requestId: data.requestId,
    action: data.action,
  })
  const structuredExtra = {
    audience: 'ai' as const,
    kind: data.kind ?? 'session',
    op: 'append' as const,
    streaming: false,
    entryId: identity.entryId,
    fingerprint: identity.fingerprint,
    ...(data.modelId ? { modelId: data.modelId } : {}),
    ...(data.sessionId ? { sessionId: data.sessionId } : {}),
    ...(typeof data.phaseAttempt === 'number' && Number.isFinite(data.phaseAttempt) ? { phaseAttempt: data.phaseAttempt } : {}),
  }
  const emissionData = {
    ticketId,
    requestId: data.requestId,
    fingerprint: identity.fingerprint,
    timestamp,
    ...(typeof data.phaseAttempt === 'number' && Number.isFinite(data.phaseAttempt) ? { phaseAttempt: data.phaseAttempt } : {}),
  }
  if (shouldSkipLogEmission(ticketId, logType, phase, content, emissionData, source, phase, structuredExtra)) {
    return
  }

  const event = createLogEvent(
    ticketId,
    logType,
    phase,
    content,
    emissionData,
    source,
    phase,
    structuredExtra,
  )
  broadcaster.broadcast(ticketId, 'log', { ...event })
  appendLogEvent(
    ticketId,
    logType,
    phase,
    content,
    emissionData,
    source,
    phase,
    structuredExtra,
  )
}

async function getTicketPendingOpenCodeQuestions(ticketId: string) {
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return null

  const sessions = listOpenCodeSessionsForTicket(ticketId, ['active'])
  if (sessions.length === 0) return []
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]))
  const adapter = getOpenCodeAdapter()
  const pending = await adapter.listPendingQuestions(ticketContext.projectRoot)

  return pending
    .filter((request) => sessionsById.has(request.sessionID))
    .map((request) => {
      const session = sessionsById.get(request.sessionID)
      return {
        type: 'opencode_question' as const,
        action: 'asked' as const,
        ticketId,
        ticketExternalId: ticketContext.externalId,
        ticketTitle: ticketContext.localTicket.title,
        status: ticketContext.localTicket.status,
        phase: session?.phase ?? ticketContext.localTicket.status,
        phaseAttempt: session?.phaseAttempt ?? undefined,
        modelId: session?.memberId ?? undefined,
        sessionId: request.sessionID,
        requestId: request.id,
        questions: request.questions,
        questionCount: request.questions.length,
        tool: request.tool,
        timestamp: new Date().toISOString(),
      }
    })
}

async function findPendingOpenCodeQuestionForTicket(ticketId: string, requestId: string) {
  const questions = await getTicketPendingOpenCodeQuestions(ticketId)
  if (!questions) return null
  return questions.find((request) => request.requestId === requestId) ?? null
}

export async function handleListOpenCodeQuestions(c: Context) {
  const ticketId = getTicketParam(c)
  if (!getTicketByRef(ticketId)) return c.json({ error: 'Ticket not found' }, 404)

  try {
    const questions = await getTicketPendingOpenCodeQuestions(ticketId)
    if (!questions) return c.json({ error: 'Ticket not found' }, 404)
    return c.json({ questions })
  } catch (err) {
    const message = getErrorMessage(err)
    emitRoutePhaseLog(ticketId, getTicketByRef(ticketId)?.status ?? 'UNKNOWN', 'error', `Failed to list OpenCode questions: ${message}`)
    return c.json({ error: 'Failed to list OpenCode questions', details: message }, 500)
  }
}

export async function handleListAllOpenCodeQuestions(c: Context) {
  const questions: NonNullable<Awaited<ReturnType<typeof getTicketPendingOpenCodeQuestions>>> = []
  const errors: Array<{ ticketId: string; message: string }> = []

  for (const ticket of listNonTerminalTickets()) {
    try {
      const ticketQuestions = await getTicketPendingOpenCodeQuestions(ticket.id)
      if (ticketQuestions?.length) questions.push(...ticketQuestions)
    } catch (err) {
      errors.push({ ticketId: ticket.id, message: getErrorMessage(err) })
    }
  }

  return c.json({
    questions,
    ...(errors.length > 0 ? { errors } : {}),
  })
}

export async function handleReplyOpenCodeQuestion(c: Context) {
  const ticketId = getTicketParam(c)
  const requestId = getRequiredRouteParam(c, 'requestId')
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const parsed = opencodeQuestionReplySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid question reply payload', details: parsed.error.flatten() }, 400)
  }

  const question = await findPendingOpenCodeQuestionForTicket(ticketId, requestId)
  if (!question) return c.json({ error: 'OpenCode question request not found for ticket' }, 404)

  try {
    await getOpenCodeAdapter().replyQuestion(requestId, parsed.data.answers, ticketContext.projectRoot)
    emitOpenCodeQuestionLog(ticketId, question.phase, '[QUESTION] AI question answered.', {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      phaseAttempt: question.phaseAttempt,
      action: 'replied',
    })
    broadcaster.broadcast(ticketId, 'needs_input', {
      type: 'opencode_question_resolved',
      action: 'replied',
      ticketId,
      requestId,
      sessionId: question.sessionId,
      timestamp: new Date().toISOString(),
    })
    return c.json({ success: true })
  } catch (err) {
    const message = getErrorMessage(err)
    emitOpenCodeQuestionLog(ticketId, question.phase, `[ERROR] Failed to answer OpenCode question: ${message}`, {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      phaseAttempt: question.phaseAttempt,
      kind: 'error',
      type: 'error',
      action: 'reply_failed',
    })
    return c.json({ error: 'Failed to answer OpenCode question', details: message }, 500)
  }
}

export async function handleRejectOpenCodeQuestion(c: Context) {
  const ticketId = getTicketParam(c)
  const requestId = getRequiredRouteParam(c, 'requestId')
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) return c.json({ error: 'Ticket not found' }, 404)

  const question = await findPendingOpenCodeQuestionForTicket(ticketId, requestId)
  if (!question) return c.json({ error: 'OpenCode question request not found for ticket' }, 404)

  try {
    await getOpenCodeAdapter().rejectQuestion(requestId, ticketContext.projectRoot)
    emitOpenCodeQuestionLog(ticketId, question.phase, '[QUESTION] AI question rejected.', {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      phaseAttempt: question.phaseAttempt,
      action: 'rejected',
    })
    broadcaster.broadcast(ticketId, 'needs_input', {
      type: 'opencode_question_resolved',
      action: 'rejected',
      ticketId,
      requestId,
      sessionId: question.sessionId,
      timestamp: new Date().toISOString(),
    })
    return c.json({ success: true })
  } catch (err) {
    const message = getErrorMessage(err)
    emitOpenCodeQuestionLog(ticketId, question.phase, `[ERROR] Failed to reject OpenCode question: ${message}`, {
      requestId,
      sessionId: question.sessionId,
      modelId: question.modelId,
      phaseAttempt: question.phaseAttempt,
      kind: 'error',
      type: 'error',
      action: 'reject_failed',
    })
    return c.json({ error: 'Failed to reject OpenCode question', details: message }, 500)
  }
}
