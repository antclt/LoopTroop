import { OPENCODE_PROVIDER_AUTH_FAILED } from '@shared/errorCodes'
import type { BlockedErrorDiagnostics } from '@shared/errorDiagnostics'
import {
  attachOpenCodeBlockedErrorDiagnostics,
  buildOpenCodeBlockedErrorDiagnostics,
  type OpenCodeBlockedErrorDiagnosticsResult,
} from './blockedErrorDiagnostics'
import type { OpenCodeResponseMeta } from './assistantMessageAnalysis'
import type { SessionOwnership } from './sessionManager'

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 529])
const NON_CONTINUABLE_STATUS_CODES = new Set([400, 401, 403, 404, 413, 422])
const PENDING_CONTINUATION_TTL_MS = 30 * 60 * 1000

export interface PendingSessionContinuation {
  ticketId: string
  phase: string
  sessionId: string
  requestedAt: string
}

export interface ContinuableBlockedErrorInput {
  diagnostics?: BlockedErrorDiagnostics | null
  errorCodes?: string[] | null
}

export interface BuildContinuationDiagnosticsInput {
  error?: unknown
  responseMeta?: OpenCodeResponseMeta
  modelId?: string
  sessionId?: string
  fallbackMessage?: string
}

export interface PreserveSessionForContinuationInput extends BuildContinuationDiagnosticsInput {
  sessionOwnership?: SessionOwnership & { ticketId?: string; phase?: string; keepActive?: boolean }
  signal?: AbortSignal
}

const pendingSessionContinuations = new Map<string, PendingSessionContinuation>()

function pruneStalePendingContinuations(now = Date.now()): void {
  for (const [sessionId, pending] of pendingSessionContinuations) {
    const requestedAt = Date.parse(pending.requestedAt)
    if (Number.isNaN(requestedAt) || now - requestedAt > PENDING_CONTINUATION_TTL_MS) {
      pendingSessionContinuations.delete(sessionId)
    }
  }
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? ''
}

function buildDiagnosticHaystack(diagnostics: BlockedErrorDiagnostics | null | undefined): string {
  return [
    diagnostics?.summary,
    diagnostics?.providerErrorType,
    diagnostics?.providerErrorTitle,
    diagnostics?.providerErrorMessage,
    diagnostics?.responseBodyPreview,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n')
}

function hasNonContinuableSignal(input: ContinuableBlockedErrorInput): boolean {
  const diagnostics = input.diagnostics ?? null
  const errorCodes = input.errorCodes ?? []
  const haystack = buildDiagnosticHaystack(diagnostics)

  return errorCodes.includes(OPENCODE_PROVIDER_AUTH_FAILED)
    || (typeof diagnostics?.statusCode === 'number' && NON_CONTINUABLE_STATUS_CODES.has(diagnostics.statusCode))
    || /\b(invalid[_ -]?request|permission|auth|authentication|authenticated|unauthorized|forbidden|credential|api key|token|billing|insufficient[_ -]?quota)\b/.test(haystack)
}

function hasContinuableSignal(diagnostics: BlockedErrorDiagnostics): boolean {
  if (diagnostics.isRetryable === true) return true
  if (typeof diagnostics.statusCode === 'number' && RETRYABLE_STATUS_CODES.has(diagnostics.statusCode)) return true
  if (diagnostics.kind === 'timeout' || diagnostics.kind === 'transport') return true

  const haystack = buildDiagnosticHaystack(diagnostics)
  return /\b(rate[_ -]?limit|usage limit|limit reached|resource exhausted|overloaded|overload|capacity|temporarily unavailable|timeout|timed out|deadline|fetch failed|connection reset|econnreset|socket hang up|network)\b/.test(haystack)
}

export function isContinuableBlockedError(input: ContinuableBlockedErrorInput): boolean {
  const diagnostics = input.diagnostics ?? null
  if (!diagnostics?.sessionId) return false
  if (hasNonContinuableSignal(input)) return false
  return hasContinuableSignal(diagnostics)
}

export function buildContinuationDiagnostics(
  input: BuildContinuationDiagnosticsInput,
): OpenCodeBlockedErrorDiagnosticsResult {
  return buildOpenCodeBlockedErrorDiagnostics({
    error: input.error,
    responseMeta: input.responseMeta,
    modelId: input.modelId,
    sessionId: input.sessionId,
    fallbackMessage: input.fallbackMessage,
  })
}

export function shouldPreserveSessionForContinuation(input: PreserveSessionForContinuationInput): boolean {
  if (input.signal?.aborted) return false
  if (!input.sessionId || !input.sessionOwnership?.ticketId || !input.sessionOwnership.phase) return false

  const diagnosticResult = buildContinuationDiagnostics(input)
  return isContinuableBlockedError({
    diagnostics: diagnosticResult.diagnostics,
    errorCodes: diagnosticResult.errorCodes,
  })
}

export function attachContinuationDiagnostics<T extends Error>(
  error: T,
  input: BuildContinuationDiagnosticsInput,
): T {
  return attachOpenCodeBlockedErrorDiagnostics(error, buildContinuationDiagnostics(input))
}

export function requestSessionContinuation(input: {
  ticketId: string
  phase: string
  sessionId: string
  requestedAt?: string
}): PendingSessionContinuation {
  pruneStalePendingContinuations()
  const pending: PendingSessionContinuation = {
    ticketId: input.ticketId,
    phase: input.phase,
    sessionId: input.sessionId,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  }
  pendingSessionContinuations.set(input.sessionId, pending)
  return pending
}

export function consumeSessionContinuation(input: {
  ticketId: string
  phase: string
  sessionId: string
}): PendingSessionContinuation | null {
  pruneStalePendingContinuations()
  const pending = pendingSessionContinuations.get(input.sessionId)
  if (!pending) return null
  if (pending.ticketId !== input.ticketId || pending.phase !== input.phase) return null
  pendingSessionContinuations.delete(input.sessionId)
  return pending
}

export function clearSessionContinuation(sessionId: string): void {
  pendingSessionContinuations.delete(sessionId)
}

export function hasPendingSessionContinuationForTicketPhase(ticketId: string, phase: string): boolean {
  pruneStalePendingContinuations()
  for (const pending of pendingSessionContinuations.values()) {
    if (pending.ticketId === ticketId && pending.phase === phase) return true
  }
  return false
}

export function clearAllPendingSessionContinuationsForTests(): void {
  pendingSessionContinuations.clear()
}
