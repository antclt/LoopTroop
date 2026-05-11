const revisions = new Map<string, number>()

function getRevisionKey(ticketId: string, scope: string): string {
  return `${ticketId}\u0000${scope}`
}

export function nextTicketUiStateRevision(ticketId: string, scope: string): number {
  const key = getRevisionKey(ticketId, scope)
  const next = (revisions.get(key) ?? 0) + 1
  revisions.set(key, next)
  return next
}

export function rememberTicketUiStateRevision(ticketId: string, scope: string, revision: number | null | undefined): void {
  if (typeof revision !== 'number' || !Number.isFinite(revision)) return
  const key = getRevisionKey(ticketId, scope)
  revisions.set(key, Math.max(revisions.get(key) ?? 0, revision))
}
