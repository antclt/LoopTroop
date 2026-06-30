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
import {
  clearNeedsInputSeen,
  getNeedsInputSignature,
  markNeedsInputSeen,
  readNeedsInputSeen,
} from '@/lib/needsInputSeen'
import {
  getStatusColor,
  formatRelativeDateChip,
  getStatusProgress,
  getStatusRingColor,
} from './ticketCardUtils'
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
    needsInputSeenSignature?: string | null
    completionDisposition?: 'merged' | 'closed_unmerged' | null
    runtime?: {
      currentBead?: number | null
      totalBeads?: number | null
      iterationCount?: number | null
      maxIterations?: number | null
      activeBeadIteration?: number | null
      maxIterationsPerBead?: number | null
    } | null
  }
  projectColor?: string
  projectIcon?: string
  projectName?: string
  searchMatchLabel?: string | null
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

export function TicketCard({ ticket, projectColor, projectIcon, projectName, searchMatchLabel }: TicketCardProps) {
  const { dispatch } = useUI()
  const { getPendingCount } = useAIQuestions()
  const isError = ticket.status === 'BLOCKED_ERROR'
  const isTerminal = ticket.status === 'COMPLETED' || ticket.status === 'CANCELED'
  const kanbanPhase = STATUS_TO_PHASE[ticket.status] ?? 'todo'
  const isInProgress = !isTerminal && kanbanPhase === 'in_progress'
  const progress = getStatusProgress(ticket.status)
  const ringColor = getStatusRingColor(ticket.status)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: ticket.currentBead,
    totalBeads: ticket.totalBeads,
    errorMessage: ticket.errorMessage,
  })
  const errorSignature = getErrorTicketSignature(ticket)
  const needsInputSignature = getNeedsInputSignature(ticket)
  // Yellow needs-input flashing is suppressed while an unseen red error is showing.
  const isNeedsInput = !isError && STATUS_TO_PHASE[ticket.status] === 'needs_input'
  const needsInputFlashing = isNeedsInput && !!needsInputSignature
  const pendingAIQuestions = getPendingCount(ticket.id)
  const hasPendingAIQuestion = pendingAIQuestions > 0
  const attentionColor = projectColor ?? '#3b82f6'

  // Track "seen" state for BLOCKED_ERROR — stop flashing after first open
  const [errorSeen, setErrorSeen] = useState(() =>
    readErrorTicketSeen(ticket.id, errorSignature, ticket.errorSeenSignature),
  )

  // Track "seen" state for NEEDS_INPUT (yellow) — stop flashing after first open,
  // revert to the static project color even if the required action was not performed.
  const [needsInputSeen, setNeedsInputSeen] = useState(() =>
    readNeedsInputSeen(ticket.id, needsInputSignature, ticket.needsInputSeenSignature),
  )

  useEffect(() => {
    if (!isError && errorSeen) {
      clearErrorTicketSeen(ticket.id)
      setErrorSeen(false)
    }
  }, [isError, ticket.id, errorSeen])

  useEffect(() => {
    if (!isNeedsInput && needsInputSeen) {
      clearNeedsInputSeen(ticket.id)
      setNeedsInputSeen(false)
    }
  }, [isNeedsInput, ticket.id, needsInputSeen])

  const handleClick = () => {
    if (isError && !errorSeen) {
      markErrorTicketSeen(ticket.id, errorSignature)
      setErrorSeen(true)
    }
    if (isNeedsInput && !needsInputSeen && needsInputSignature) {
      markNeedsInputSeen(ticket.id, needsInputSignature)
      setNeedsInputSeen(true)
    }
    dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
  }

  const errorFlashing = isError && !errorSeen
  // Yellow supersedes the project-color pending-question pulse for needs_input tickets:
  // unseen needs-input → yellow pulse; seen needs-input → static project color, no pulse.
  const needsInputYellowFlashing = needsInputFlashing && !needsInputSeen && !errorFlashing
  const showPendingQuestionPulse = hasPendingAIQuestion && !errorFlashing && !needsInputFlashing

  return (
    <Card
      className={cn(
        'min-w-0 max-w-full cursor-pointer overflow-hidden p-3 transition-all hover:shadow-md',
        errorFlashing && 'animate-pulse border-destructive border-2 ring-4 ring-red-500/70 bg-red-50/60 dark:bg-red-950/30 shadow-[0_0_0_2px_rgba(239,68,68,0.6),0_0_20px_rgba(239,68,68,0.4),0_10px_30px_rgba(239,68,68,0.3)]',
        needsInputYellowFlashing && 'lt-needs-input-pulse border-2 border-amber-400/80 bg-amber-50/50 dark:border-amber-500/70 dark:bg-amber-950/20 shadow-[0_0_0_2px_rgba(251,191,36,0.45),0_0_14px_rgba(251,191,36,0.30)]',
        showPendingQuestionPulse && 'animate-pulse border-2 bg-primary/5',
      )}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: attentionColor,
        ...(needsInputYellowFlashing
          ? {
              borderTopColor: '#f59e0b',
              borderRightColor: '#f59e0b',
              borderBottomColor: '#f59e0b',
              borderLeftColor: '#f59e0b',
              boxShadow: '0 0 0 2px rgba(251,191,36,0.45), 0 0 14px rgba(251,191,36,0.30)',
            }
          : showPendingQuestionPulse
            ? {
                borderTopColor: attentionColor,
                borderRightColor: attentionColor,
                borderBottomColor: attentionColor,
                borderLeftColor: attentionColor,
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
          {isError && <AlertTriangle className="h-3 w-3 text-destructive animate-wobble-throb" />}
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
          {searchMatchLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  tabIndex={0}
                  className="shrink-0 border-sky-300 bg-sky-50 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                >
                  {searchMatchLabel}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-center text-balance">Dashboard search matched this field.</TooltipContent>
            </Tooltip>
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
                        {formatRelativeDateChip(ticket.updatedAt)}
                      </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center text-balance">{new Date(ticket.updatedAt).toLocaleString()}</TooltipContent>
              </Tooltip>
      </div>
    </Card>
  )
}
