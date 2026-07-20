import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export type AutosaveStatusState = 'pending' | 'saving' | 'saved' | 'conflict' | 'error'

interface AutosaveStatusProps {
  state: AutosaveStatusState
  lastSavedAt?: Date | string | null
  label?: 'Autosave on' | 'Draft autosave on'
  className?: string
  conflictMessage?: string
}

function relativeAutosaveLabel(savedAt: Date, now: number) {
  const seconds = Math.max(0, Math.floor((now - savedAt.getTime()) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function AutosaveStatus({
  state,
  lastSavedAt = null,
  label = 'Autosave on',
  className,
  conflictMessage = 'Autosave conflict',
}: AutosaveStatusProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const savedAt = useMemo(() => {
    if (!lastSavedAt) return null
    const parsed = lastSavedAt instanceof Date ? lastSavedAt : new Date(lastSavedAt)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }, [lastSavedAt])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const message = state === 'saving'
    ? 'Saving…'
    : state === 'conflict'
      ? conflictMessage
      : state === 'error'
        ? 'Autosave failed'
        : state === 'pending'
          ? 'Changes save automatically'
          : savedAt
            ? `Last save ${relativeAutosaveLabel(savedAt, nowMs)}`
            : 'Changes save automatically'

  return (
    <p className={cn('text-xs text-muted-foreground', className)} title={savedAt?.toLocaleString()}>
      {label} · {message}
    </p>
  )
}
