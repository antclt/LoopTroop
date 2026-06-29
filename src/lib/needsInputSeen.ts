import { STATUS_TO_PHASE } from '@/lib/workflowMeta'

/**
 * Acknowledgment store for the "Needs Input" kanban column.
 *
 * Mirrors `errorTicketSeen.ts` but covers every status that maps to
 * `kanbanPhase === 'needs_input'` (interview answers, approvals, PR review,
 * etc.). `BLOCKED_ERROR` is intentionally excluded — it keeps its own red
 * error-flashing acknowledgment.
 *
 * When a ticket enters a needs-input wait, its dashboard card flashes a soft
 * yellow border. The moment the user opens the ticket, the flashing stops and
 * the border reverts to the static project color, even if the required action
 * was not performed. A *new* wait (different status, or re-entry with a fresh
 * `updatedAt`) produces a new signature and flashes again.
 */

const seenNeedsInputTickets = new Map<string, string>()

interface NeedsInputTicketSnapshot {
  id: string
  status: string
  updatedAt: string
}

function getNeedsInputSeenStorageKey(ticketId: string): string {
  return `needs-input-seen-${ticketId}`
}

/**
 * Returns a stable signature for the current needs-input wait, or `null` when
 * the ticket is not waiting on the user (or when it is in `BLOCKED_ERROR`,
 * which is owned by the error-attention store).
 *
 * v1 reason token = `updatedAt`. WAITING_* states are paused, so `updatedAt`
 * only advances when the wait reason genuinely changes (e.g. PRD approval →
 * beads approval) or on re-entry, which is exactly when we want to re-flash.
 */
export function getNeedsInputSignature(ticket: NeedsInputTicketSnapshot): string | null {
  if (ticket.status === 'BLOCKED_ERROR') return null
  if (STATUS_TO_PHASE[ticket.status] !== 'needs_input') return null
  return `${ticket.status}|${ticket.updatedAt}`
}

export function readNeedsInputSeen(
  ticketId: string,
  signature: string | null,
  persistedSignature?: string | null,
): boolean {
  if (!signature) return false
  if (seenNeedsInputTickets.get(ticketId) === signature) return true
  if (persistedSignature === signature) {
    seenNeedsInputTickets.set(ticketId, signature)
    return true
  }
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(getNeedsInputSeenStorageKey(ticketId))
    const seen = stored === signature || stored === '1'
    if (seen) seenNeedsInputTickets.set(ticketId, signature)
    return seen
  } catch {
    return false
  }
}

export function markNeedsInputSeen(ticketId: string, signature: string | null): void {
  if (!signature) return
  seenNeedsInputTickets.set(ticketId, signature)
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getNeedsInputSeenStorageKey(ticketId), signature)
  } catch {
    // Storage failures should not block ticket navigation.
  }
}

export function clearNeedsInputSeen(ticketId: string): void {
  seenNeedsInputTickets.delete(ticketId)
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getNeedsInputSeenStorageKey(ticketId))
  } catch {
    // Ignore storage cleanup failures.
  }
}
