import type { LogEntry } from '@/context/LogContext'
import type { Ticket } from '@/hooks/useTickets'
import { isSystem } from './logFormat'

export interface RenderedBeadSection {
  beadId: string
  ordinal: number
  total: number
  title: string
  entries: LogEntry[]
}

export interface BeadSectionsResult {
  preambleEntries: LogEntry[]
  beadSections: RenderedBeadSection[]
}

const COMPLETED_BEAD_STATUSES = new Set(['done', 'completed', 'skipped'])
const EXECUTING_BEAD_PATTERN = /^(?:\[[A-Z_]+\]\s+)?Executing bead\s+([^:]+):\s+(.+?)\s*$/

export function BeadDelimiter({ ordinal, total, title }: { ordinal: number; total: number; title?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-4 select-none" aria-label={`Bead ${ordinal}/${total}`}>
      <div className="flex-1 border-t border-border/40" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
        {`Bead ${ordinal}/${total}`}
      </span>
      {title ? (
        <span className="max-w-[45%] truncate text-[10px] text-muted-foreground/80">
          {title}
        </span>
      ) : null}
      <div className="flex-1 border-t border-border/40" />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseExecutingBead(entry: LogEntry): { beadId: string; title: string } | null {
  if (!isSystem(entry)) return null
  const match = entry.line.match(EXECUTING_BEAD_PATTERN)
  if (!match) return null
  return {
    beadId: match[1]!.trim(),
    title: match[2]!.trim(),
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function isCompletedBeadStatus(status?: string | null): boolean {
  return status ? COMPLETED_BEAD_STATUSES.has(status.toLowerCase()) : false
}

/**
 * Splits a single phase's log entries into preamble + bead sections.
 * Returns `null` when no beads are detected (caller should fall back to flat list).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildBeadSections(
  entries: LogEntry[],
  visibleEntryIds: Set<string>,
  ticket?: Ticket,
): BeadSectionsResult | null {
  const runtimeBeads = ticket?.runtime.beads ?? []
  const runtimeBeadMap = new Map(
    runtimeBeads.map((bead, index) => [
      bead.id,
      {
        ordinal: index + 1,
        title: bead.title,
        status: bead.status,
      },
    ]),
  )
  const activeBeadId = ticket?.runtime.activeBeadId ?? null
  const runtimeTotal = ticket?.runtime.totalBeads ?? 0

  const preambleEntries: LogEntry[] = []
  const discoveredBeadIds: string[] = []
  const beadSegments: Array<{ beadId: string; title: string; entries: LogEntry[] }> = []
  let currentSegment: { beadId: string; title: string; entries: LogEntry[] } | null = null

  for (const entry of entries) {
    const beadStart = parseExecutingBead(entry)
    if (beadStart) {
      if (currentSegment) {
        beadSegments.push(currentSegment)
      }
      currentSegment = {
        beadId: beadStart.beadId,
        title: beadStart.title,
        entries: [entry],
      }
      if (!discoveredBeadIds.includes(beadStart.beadId)) {
        discoveredBeadIds.push(beadStart.beadId)
      }
      continue
    }

    if (currentSegment) {
      currentSegment.entries.push(entry)
    } else {
      preambleEntries.push(entry)
    }
  }

  if (currentSegment) {
    beadSegments.push(currentSegment)
  }

  if (beadSegments.length === 0) {
    return null
  }

  const discoveryOrdinalMap = new Map(discoveredBeadIds.map((beadId, index) => [beadId, index + 1]))
  const total = runtimeTotal > 0 ? runtimeTotal : discoveredBeadIds.length
  const shouldFilterByRuntimeStatus = runtimeBeadMap.size > 0

  const visiblePreambleEntries = preambleEntries.filter((entry) => visibleEntryIds.has(entry.entryId))
  const beadSections = beadSegments
    .map((segment, segmentIndex): RenderedBeadSection | null => {
      const visibleEntries = segment.entries.filter((entry) => visibleEntryIds.has(entry.entryId))
      if (visibleEntries.length === 0) return null

      const runtimeBead = runtimeBeadMap.get(segment.beadId)
      if (
        shouldFilterByRuntimeStatus
        && segment.beadId !== activeBeadId
        && !isCompletedBeadStatus(runtimeBead?.status)
      ) {
        return null
      }

      const ordinal = runtimeBead?.ordinal ?? discoveryOrdinalMap.get(segment.beadId) ?? segmentIndex + 1
      return {
        beadId: segment.beadId,
        ordinal,
        total: total > 0 ? total : ordinal,
        title: runtimeBead?.title?.trim() || segment.title,
        entries: visibleEntries,
      }
    })
    .filter((section): section is RenderedBeadSection => section !== null)

  if (visiblePreambleEntries.length === 0 && beadSections.length === 0) {
    return null
  }

  return {
    preambleEntries: visiblePreambleEntries,
    beadSections,
  }
}
