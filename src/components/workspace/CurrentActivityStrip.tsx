import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock3, RefreshCw } from 'lucide-react'
import type { LogEntry } from '@/context/LogContext'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { cn } from '@/lib/utils'
import { deriveCurrentActivity, formatElapsedDuration, type CurrentActivity } from './currentActivity'

interface CurrentActivityStripProps {
  entries: LogEntry[]
  enabled?: boolean
  className?: string
}

const severityClassName: Record<CurrentActivity['severity'], string> = {
  info: 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  error: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

function ActivityIcon({ activity }: { activity: CurrentActivity }) {
  if (activity.kind === 'provider_retrying') {
    return <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (activity.severity === 'error' || activity.severity === 'warning') {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  return <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}

export function CurrentActivityStrip({ entries, enabled = true, className }: CurrentActivityStripProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    setNowMs(Date.now())
  }, [entries])

  const activity = useMemo(
    () => (enabled ? deriveCurrentActivity(entries, nowMs) : null),
    [enabled, entries, nowMs],
  )

  useEffect(() => {
    if (!activity?.active) return
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [activity?.active])

  if (!activity) return null

  const elapsedLabel = activity.elapsedMs === undefined
    ? null
    : formatElapsedDuration(activity.elapsedMs)
  const modelLabel = activity.modelId ? getModelDisplayName(activity.modelId) : null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Current activity"
      className={cn(
        'mx-1 mb-1 flex min-h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border px-2.5 py-1.5 text-xs',
        'shadow-none',
        severityClassName[activity.severity],
        className,
      )}
    >
      <ActivityIcon activity={activity} />
      <span className="min-w-0 shrink truncate font-medium text-foreground">
        {activity.label}
      </span>
      {elapsedLabel ? (
        <span className="shrink-0 text-muted-foreground">· {elapsedLabel}</span>
      ) : null}
      {modelLabel ? (
        <span className="min-w-0 shrink truncate text-muted-foreground" title={activity.modelId}>
          · model {modelLabel}
        </span>
      ) : null}
      {activity.sessionId ? (
        <span className="min-w-0 shrink truncate text-muted-foreground" title={activity.sessionId}>
          · session {activity.sessionId}
        </span>
      ) : null}
      {activity.beadId ? (
        <span className="min-w-0 shrink truncate text-muted-foreground" title={activity.beadId}>
          · bead {activity.beadId}
        </span>
      ) : null}
      {activity.diagnostic ? (
        <span className="ml-auto shrink-0 rounded border border-current/20 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {activity.diagnostic}
        </span>
      ) : null}
    </div>
  )
}
