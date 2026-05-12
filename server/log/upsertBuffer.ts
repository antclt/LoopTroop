import { createHash } from 'node:crypto'
import type { LogEvent } from './types'

export interface RecentLogScope {
  channel: 'emit' | 'normal' | 'debug' | 'ai'
  phase: string
  phaseAttempt: number
}

export const RECENT_LOG_DEDUP_WINDOW_MS = 1_000
const MAX_RECENT_LOG_ENTRIES_PER_TICKET = 512
const MAX_RECENT_LOG_TICKETS = 100

const recentLogsByTicket = new Map<string, Map<string, number>>()

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => normalizeForHash(entry))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (key === 'ticketId' || key === 'timestamp') continue
      const nested = normalizeForHash(record[key])
      if (nested !== undefined) {
        normalized[key] = nested
      }
    }
    return normalized
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  return value
}

function hashLogEvent(event: LogEvent): string {
  const normalized = normalizeForHash({
    type: event.type,
    phase: event.phase,
    phaseAttempt: event.phaseAttempt ?? 1,
    message: event.message,
    content: event.content,
    source: event.source,
    status: event.status,
    data: event.data,
    entryId: event.entryId,
    fingerprint: event.fingerprint,
    op: event.op,
    audience: event.audience,
    kind: event.kind,
    modelId: event.modelId,
    sessionId: event.sessionId,
    beadId: event.beadId,
    streaming: event.streaming,
  })

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function buildScopeKey(scope: RecentLogScope): string {
  return `${scope.channel}:${scope.phase}:${scope.phaseAttempt}`
}

function pruneExpiredEntries(bucket: Map<string, number>, now: number): void {
  for (const [key, timestamp] of bucket) {
    if (now - timestamp >= RECENT_LOG_DEDUP_WINDOW_MS) {
      bucket.delete(key)
    }
  }
}

export function shouldSkipRecentLog(
  ticketId: string,
  scope: RecentLogScope,
  event: LogEvent,
  now: number = Date.now(),
): boolean {
  if (!recentLogsByTicket.has(ticketId) && recentLogsByTicket.size >= MAX_RECENT_LOG_TICKETS) {
    const oldestTicketKey = recentLogsByTicket.keys().next().value
    if (oldestTicketKey !== undefined) {
      recentLogsByTicket.delete(oldestTicketKey)
    }
  }

  const bucket = recentLogsByTicket.get(ticketId) ?? new Map<string, number>()
  pruneExpiredEntries(bucket, now)

  const key = `${buildScopeKey(scope)}:${hashLogEvent(event)}`
  const previousTimestamp = bucket.get(key)
  if (previousTimestamp !== undefined && now - previousTimestamp < RECENT_LOG_DEDUP_WINDOW_MS) {
    bucket.delete(key)
    bucket.set(key, now)
    recentLogsByTicket.set(ticketId, bucket)
    return true
  }

  if (bucket.has(key)) {
    bucket.delete(key)
  }
  bucket.set(key, now)

  while (bucket.size > MAX_RECENT_LOG_ENTRIES_PER_TICKET) {
    const oldestKey = bucket.keys().next().value
    if (!oldestKey) break
    bucket.delete(oldestKey)
  }

  recentLogsByTicket.set(ticketId, bucket)
  return false
}

export function clearRecentLogDedup(ticketId?: string): void {
  if (ticketId) {
    recentLogsByTicket.delete(ticketId)
    return
  }

  recentLogsByTicket.clear()
}
