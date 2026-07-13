import { listManualQaVersions, readManualQaSummary } from './storage'
import type { ManualQaSummary } from './types'

type CompletedManualQaOutcome = Exclude<ManualQaSummary['outcome'], 'failed'>

export interface ManualQaDeliverySummary {
  version: number
  outcome: CompletedManualQaOutcome
  createdFixBeadIds: string[]
  improvementTicketIds: string[]
  waivedItemIds: string[]
  skipReason: string | null
}

/**
 * Build the compact delivery view across the whole QA loop. The newest
 * completed round owns the outcome/waiver/skip state, while created work is
 * cumulative because fix beads and improvement tickets from earlier rounds
 * remain part of the delivered ticket's history.
 */
export function readManualQaDeliverySummary(ticketDir: string): ManualQaDeliverySummary | null {
  const summaries = listManualQaVersions(ticketDir)
    .map((version) => readManualQaSummary(ticketDir, version))
    .filter((summary): summary is ManualQaSummary & { outcome: CompletedManualQaOutcome } => (
      summary !== null && summary.outcome !== 'failed'
    ))
  const latest = summaries.at(-1)
  if (!latest) return null

  return {
    version: latest.version,
    outcome: latest.outcome,
    createdFixBeadIds: [...new Set(summaries.flatMap((summary) => summary.createdFixBeadIds))],
    improvementTicketIds: [...new Set(summaries.flatMap((summary) => summary.improvementTicketIds))],
    waivedItemIds: latest.waivedItemIds,
    skipReason: latest.skipReason ?? null,
  }
}
