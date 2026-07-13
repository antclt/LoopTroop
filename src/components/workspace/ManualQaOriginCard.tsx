import { Badge } from '@/components/ui/badge'
import type { ManualQaBeadOrigin } from '@/hooks/useTickets'
import { manualQaEvidenceUrl } from '@/hooks/useManualQA'

const SAFE_RASTER_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export function ManualQaOriginBadge({ origin }: { origin: ManualQaBeadOrigin }) {
  return <Badge className="h-4 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">Manual QA Fix · v{origin.version}</Badge>
}

export function ManualQaOriginCard({ origin, compact = false }: { origin: ManualQaBeadOrigin; compact?: boolean }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 font-sans">
      <div className="flex flex-wrap items-center gap-2">
        <ManualQaOriginBadge origin={origin} />
        <span className="text-[10px] text-muted-foreground">Source {origin.sourceTicketExternalId}</span>
        {origin.imageDelivery && <Badge variant="outline" className="h-4 px-1 text-[9px]">Images: {origin.imageDelivery.replace('_', ' ')}</Badge>}
      </div>
      <div className="mt-2 space-y-3">
        {origin.sourceItems.map((source) => (
          <div key={source.itemId} className="text-xs">
            <p className="font-medium">{source.behavior || source.itemId} <code className="ml-1 text-[10px] text-muted-foreground">{source.itemId}</code></p>
            <p className="mt-1"><span className="font-medium text-red-700 dark:text-red-300">Observed:</span> {source.observation}</p>
            <p className="mt-1"><span className="font-medium text-green-700 dark:text-green-300">Expected:</span> {source.expectedResult}</p>
            {source.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {source.evidence.map((evidence) => {
                  const downloadUrl = manualQaEvidenceUrl(origin.sourceTicketId, origin.version, source.itemId, evidence.id)
                  const canPreview = !compact && SAFE_RASTER_MEDIA_TYPES.has(evidence.mediaType)
                  return (
                    <a key={evidence.id} href={downloadUrl} target="_blank" rel="noreferrer" className="rounded border border-border bg-background p-1 text-[10px] text-primary hover:underline">
                      {canPreview && <img src={`${downloadUrl}?inline=true`} alt={evidence.originalName} className="mb-1 h-16 max-w-28 object-contain" />}
                      {evidence.originalName}
                    </a>
                  )
                })}
              </div>
            )}
            {source.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {source.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="rounded border border-border bg-background px-2 py-1 text-[10px] text-primary hover:underline">{link.label || link.url}</a>)}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Retry notes are recorded separately in the bead runtime metadata.</p>
    </div>
  )
}
