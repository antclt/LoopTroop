import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Loader2, AlertTriangle, ChevronUp, ChevronDown, Minus, HelpCircle } from 'lucide-react'
import { useUI } from '@/context/useUI'
import { useAIQuestions } from '@/context/useAIQuestions'
import { STATUS_DESCRIPTIONS, STATUS_TO_PHASE, getStatusUserLabel } from '@/lib/workflowMeta'
import {
  clearErrorTicketSeen,
  getErrorTicketSignature,
  markErrorTicketSeen,
  readErrorTicketSeen,
} from '@/lib/errorTicketSeen'
import { getStatusColor, getRelativeTime, getStatusProgress, getStatusRingColor } from './ticketCardUtils'
import { ProgressRing } from './ProgressRing'
import { TicketExternalId } from '@/components/ticket/TicketExternalId'
import { getTicketExternalIdLabel } from '@/lib/ticketDisplay'


interface TicketCardProps {
  ticket: {
    id: string
    externalId: string
    isDisplayOnlyMock?: boolean | null
    title: string
    priority: number
    status: string
    updatedAt: string
    projectId: number
    currentBead?: number | null
    totalBeads?: number | null
    errorMessage?: string | null
    errorSeenSignature?: string | null
    completionDisposition?: 'merged' | 'closed_unmerged' | null
  }
  projectColor?: string
  projectIcon?: string
  projectName?: string
}

function PriorityArrows({ priority }: { priority: number }) {
  switch (priority) {
    case 1:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex flex-col items-center -space-y-1 text-red-600">
                    <ChevronUp className="h-3 w-3" strokeWidth={3} />
                    <ChevronUp className="h-3 w-3" strokeWidth={3} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">Very High</TooltipContent>
          </Tooltip>
      )
    case 2:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center text-orange-500">
                    <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">High</TooltipContent>
          </Tooltip>
      )
    case 3:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center text-gray-400">
                    <Minus className="h-3 w-3" strokeWidth={2.5} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">Normal</TooltipContent>
          </Tooltip>
      )
    case 4:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center text-blue-400">
                    <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">Low</TooltipContent>
          </Tooltip>
      )
    case 5:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex flex-col items-center -space-y-1 text-blue-400">
                    <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                    <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">Very Low</TooltipContent>
          </Tooltip>
      )
    default:
      return (
        <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center text-gray-400">
                    <Minus className="h-3 w-3" strokeWidth={2.5} />
                  </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">Normal</TooltipContent>
          </Tooltip>
      )
  }
}

export function TicketCard({ ticket, projectColor, projectIcon, projectName }: TicketCardProps) {
  const { dispatch } = useUI()
  const { getPendingCount } = useAIQuestions()
  const isError = ticket.status === 'BLOCKED_ERROR'
  const isTerminal = ticket.status === 'COMPLETED' || ticket.status === 'CANCELED'
  const isInProgress = !isTerminal && STATUS_TO_PHASE[ticket.status] === 'in_progress'
  const progress = getStatusProgress(ticket.status)
  const ringColor = getStatusRingColor(ticket.status)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: ticket.currentBead,
    totalBeads: ticket.totalBeads,
    errorMessage: ticket.errorMessage,
  })
  const errorSignature = getErrorTicketSignature(ticket)
  const pendingAIQuestions = getPendingCount(ticket.id)
  const hasPendingAIQuestion = pendingAIQuestions > 0
  const attentionColor = projectColor ?? '#3b82f6'

  // Track "seen" state for BLOCKED_ERROR — stop flashing after first open
  const [errorSeen, setErrorSeen] = useState(() =>
    readErrorTicketSeen(ticket.id, errorSignature, ticket.errorSeenSignature),
  )

  useEffect(() => {
    if (!isError && errorSeen) {
      clearErrorTicketSeen(ticket.id)
      setErrorSeen(false)
    }
  }, [isError, ticket.id, errorSeen])

  const handleClick = () => {
    if (isError && !errorSeen) {
      markErrorTicketSeen(ticket.id, errorSignature)
      setErrorSeen(true)
    }
    dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
  }

  return (
    <Card
      className={cn(
        'min-w-0 max-w-full cursor-pointer overflow-hidden p-3 transition-all hover:shadow-md',
        isError && !errorSeen && 'animate-pulse border-destructive border-2 ring-4 ring-red-500/70 bg-red-50/60 dark:bg-red-950/30 shadow-[0_0_0_2px_rgba(239,68,68,0.6),0_0_20px_rgba(239,68,68,0.4),0_10px_30px_rgba(239,68,68,0.3)]',
        hasPendingAIQuestion && !(isError && !errorSeen) && 'animate-pulse border-2 bg-primary/5',
      )}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: attentionColor,
        ...(hasPendingAIQuestion && !(isError && !errorSeen)
          ? {
              borderColor: attentionColor,
              boxShadow: `0 0 0 2px ${attentionColor}55, 0 0 18px ${attentionColor}40`,
            }
          : {}),
      }}
      onClick={handleClick}
      aria-label={`Open ticket ${getTicketExternalIdLabel(ticket.externalId, ticket.isDisplayOnlyMock)}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <TicketExternalId
          externalId={ticket.externalId}
          isDisplayOnlyMock={ticket.isDisplayOnlyMock}
          className="min-w-0 flex-1 break-words text-xs font-mono text-muted-foreground [overflow-wrap:anywhere]"
        />
        <div className="flex shrink-0 items-center gap-1">
          <PriorityArrows priority={ticket.priority} />
          {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {hasPendingAIQuestion && <HelpCircle className="h-3 w-3" style={{ color: attentionColor }} />}
          {isError && <AlertTriangle className="h-3 w-3 text-destructive" />}
        </div>
      </div>
      <p className="mt-1 break-words text-sm font-medium leading-tight [overflow-wrap:anywhere]">{ticket.title}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
        {projectIcon && (projectIcon.startsWith('data:') ? <img src={projectIcon} className="h-4 w-4 shrink-0 rounded" alt="" /> : <span className="shrink-0 text-xs">{projectIcon}</span>)}
        {projectName && <span className="min-w-0 max-w-full break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{projectName}</span>}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={cn('min-w-0 max-w-full break-words text-xs leading-4 whitespace-normal [overflow-wrap:anywhere] sm:max-w-[180px]', getStatusColor(ticket.status))}>
                {statusLabel}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-center text-balance">{STATUS_DESCRIPTIONS[ticket.status] ?? statusLabel}</TooltipContent>
          </Tooltip>
          {ticket.status === 'COMPLETED' && ticket.completionDisposition && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {ticket.completionDisposition === 'merged' ? 'Merged' : 'Unmerged'}
            </Badge>
          )}
          {hasPendingAIQuestion && (
            <Badge variant="outline" className="shrink-0 text-[10px]" style={{ borderColor: attentionColor, color: attentionColor }}>
              AI question {pendingAIQuestions}
            </Badge>
          )}
          {progress !== null && (
            <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                    <ProgressRing percent={progress} colorClass={ringColor} />
                                    <span className={ringColor}>{progress}%</span>
                                  </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-center text-balance">Workflow progress</TooltipContent>
                      </Tooltip>
          )}
        </div>
        <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {getRelativeTime(ticket.updatedAt)}
                      </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center text-balance">{new Date(ticket.updatedAt).toLocaleString()}</TooltipContent>
              </Tooltip>
      </div>
    </Card>
  )
}
