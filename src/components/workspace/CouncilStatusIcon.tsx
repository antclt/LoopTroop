import { cn } from '@/lib/utils'
import {
  Pencil,
  Hourglass,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import type { CouncilAction, CouncilOutcome } from './councilArtifacts'

interface CouncilStatusIconProps {
  outcome?: CouncilOutcome
  action?: CouncilAction
  className?: string
}

export function CouncilStatusIcon({ outcome, action, className }: CouncilStatusIconProps) {
  // 1. Terminal/Finished Outcomes
  if (outcome === 'failed') {
    return <AlertTriangle className={cn('h-3.5 w-3.5 text-red-500 animate-wobble-throb shrink-0', className)} />
  }
  if (outcome === 'timed_out') {
    return <Clock className={cn('h-3.5 w-3.5 text-amber-500 shrink-0', className)} />
  }
  if (outcome === 'invalid_output') {
    return <XCircle className={cn('h-3.5 w-3.5 text-red-500 shrink-0', className)} />
  }
  if (outcome === 'completed') {
    return <CheckCircle2 className={cn('h-3.5 w-3.5 text-green-500 shrink-0', className)} />
  }

  // 2. Pending Actions / Fallbacks
  const activeAction = outcome === 'pending' ? action : (action || 'drafting')

  switch (activeAction) {
    case 'scoring':
      return <Hourglass className={cn('h-3.5 w-3.5 text-blue-500 animate-hourglass-flip shrink-0', className)} />
    case 'verifying':
      return <Search className={cn('h-3.5 w-3.5 text-blue-500 animate-search-sweep shrink-0', className)} />
    case 'refining':
      return <RefreshCw className={cn('h-3.5 w-3.5 text-blue-500 animate-slow-spin shrink-0', className)} />
    case 'drafting':
    default:
      return <Pencil className={cn('h-3.5 w-3.5 text-blue-500 animate-pencil-write shrink-0', className)} />
  }
}
