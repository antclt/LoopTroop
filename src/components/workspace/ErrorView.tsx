import { useState } from 'react'
import { AlertTriangle, CirclePlay, Clock3, FilePlus2, Info, MessageSquarePlus, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTicketAction } from '@/hooks/useTickets'
import { useLogs } from '@/context/useLogContext'
import type { LogEntry } from '@/context/LogContext'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import type { Ticket } from '@/hooks/useTickets'
import { formatTimestamp, formatTimestampString } from './logFormat'
import {
  formatErrorOccurrenceLabel,
  formatErrorOccurrenceStatus,
  getActiveErrorOccurrence,
  getTicketErrorOccurrences,
  type TicketErrorOccurrence,
} from '@/lib/errorOccurrences'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { BEAD_RETRY_BUDGET_EXHAUSTED } from '@shared/errorCodes'
import {
  FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
  FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
} from '@shared/finalTestFileEffects'
import type { WorkflowAction } from '@shared/workflowMeta'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CancelTicketDialog } from '@/components/ticket/CancelTicketDialog'

const MAX_RETRY_NOTE_LENGTH = 20_000

interface ErrorViewProps {
  ticket: Ticket
  occurrence?: TicketErrorOccurrence | null
  readOnly?: boolean
}

function mergeErrorLogs(previousPhaseLogs: LogEntry[], blockedLogs: LogEntry[]): LogEntry[] {
  const seen = new Set<string>()
  const merged = [...previousPhaseLogs, ...blockedLogs].filter((entry, index) => {
    const key = entry.timestamp
      ? `${entry.timestamp}|${entry.status}|${entry.source}|${entry.line}`
      : `no-ts:${index}|${entry.status}|${entry.source}|${entry.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return merged.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
    if (Number.isNaN(aTime)) return 1
    if (Number.isNaN(bTime)) return -1
    return aTime - bTime
  })
}

function readTimestamp(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function filterLogsWithinWindow(
  logs: LogEntry[],
  options: {
    startTime?: number | null
    endTime?: number | null
    includeStart?: boolean
    includeEnd?: boolean
  },
) {
  const {
    startTime = null,
    endTime = null,
    includeStart = true,
    includeEnd = true,
  } = options

  return logs.filter((entry) => {
    const timestamp = readTimestamp(entry.timestamp)
    if (timestamp === null) return true
    if (startTime !== null) {
      if (includeStart ? timestamp < startTime : timestamp <= startTime) return false
    }
    if (endTime !== null) {
      if (includeEnd ? timestamp > endTime : timestamp >= endTime) return false
    }
    return true
  })
}

function formatDiagnosticKind(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function buildDiagnosticRows(diagnostics: NonNullable<TicketErrorOccurrence['diagnostics']>) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Kind', value: formatDiagnosticKind(diagnostics.kind) },
    { label: 'Source', value: formatDiagnosticKind(diagnostics.source) },
  ]

  if (diagnostics.modelId) rows.push({ label: 'Model', value: diagnostics.modelId })
  if (diagnostics.providerId) rows.push({ label: 'Provider', value: diagnostics.providerId })
  if (diagnostics.providerModelId) rows.push({ label: 'Provider model', value: diagnostics.providerModelId })
  if (diagnostics.requestModel && diagnostics.requestModel !== diagnostics.modelId) rows.push({ label: 'Request model', value: diagnostics.requestModel })
  if (diagnostics.sessionId) rows.push({ label: 'Session', value: diagnostics.sessionId })
  if (typeof diagnostics.statusCode === 'number') rows.push({ label: 'HTTP', value: String(diagnostics.statusCode) })
  if (diagnostics.providerErrorType) rows.push({ label: 'Provider type', value: diagnostics.providerErrorType })
  if (typeof diagnostics.isRetryable === 'boolean') rows.push({ label: 'Retryable', value: diagnostics.isRetryable ? 'yes' : 'no' })
  if (diagnostics.providerErrorTitle) rows.push({ label: 'Provider title', value: diagnostics.providerErrorTitle })
  if (diagnostics.providerErrorMessage && diagnostics.providerErrorMessage !== diagnostics.summary) {
    rows.push({ label: 'Provider message', value: diagnostics.providerErrorMessage })
  }
  if (diagnostics.finishReason) rows.push({ label: 'Finish reason', value: diagnostics.finishReason })
  if (typeof diagnostics.outputTokens === 'number') rows.push({ label: 'Output tokens', value: diagnostics.outputTokens.toLocaleString() })
  if (typeof diagnostics.reasoningTokens === 'number') rows.push({ label: 'Reasoning tokens', value: diagnostics.reasoningTokens.toLocaleString() })
  if (typeof diagnostics.inputTokens === 'number') rows.push({ label: 'Input tokens', value: diagnostics.inputTokens.toLocaleString() })

  return rows
}

function normalizeErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function ErrorView({ ticket, occurrence, readOnly = false }: ErrorViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryNoteDialogOpen, setRetryNoteDialogOpen] = useState(false)
  const [retryNote, setRetryNote] = useState('')
  const [retryNoteError, setRetryNoteError] = useState<string | null>(null)
  const [retryNoteSubmitting, setRetryNoteSubmitting] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const logCtx = useLogs()
  const failedBead = ticket.runtime.lastFailedBeadId
    ? ticket.runtime.beads?.find((bead) => bead.id === ticket.runtime.lastFailedBeadId) ?? null
    : null
  const activeRuntimeBead = ticket.runtime.activeBeadId
    ? ticket.runtime.beads?.find((bead) => bead.id === ticket.runtime.activeBeadId) ?? null
    : null
  const failedBeadNoteGroups = [
    { title: 'Failed Iteration Notes', notes: failedBead?.failedIterationNotes ?? [] },
    { title: 'User Retry Notes', notes: failedBead?.userRetryNotes ?? [] },
    { title: 'Finalization Failure Notes', notes: failedBead?.finalizationFailureNotes ?? [] },
  ].filter((group) => group.notes.length > 0)
  const visibleOccurrence = occurrence ?? getActiveErrorOccurrence(ticket)
  const retryActionLabel = (
    visibleOccurrence?.blockedFromStatus === 'CODING'
    && visibleOccurrence.errorCodes.includes(BEAD_RETRY_BUDGET_EXHAUSTED)
    && typeof ticket.runtime.maxIterationsPerBead === 'number'
    && ticket.runtime.maxIterationsPerBead > 0
  )
    ? `Try again ${ticket.runtime.maxIterationsPerBead} ${ticket.runtime.maxIterationsPerBead === 1 ? 'retry' : 'retries'}`
    : 'Retry'
  const errorLogs = (() => {
    if (!visibleOccurrence) {
      return logCtx?.getLogsForPhase('BLOCKED_ERROR') ?? []
    }

    const allOccurrences = getTicketErrorOccurrences(ticket)
    const occurrenceIndex = allOccurrences.findIndex((candidate) => candidate.id === visibleOccurrence.id)
    const previousOccurrence = occurrenceIndex > 0 ? allOccurrences[occurrenceIndex - 1] : null
    const previousResolutionTime = readTimestamp(previousOccurrence?.resolvedAt ?? previousOccurrence?.occurredAt ?? null)
    const blockedAt = readTimestamp(visibleOccurrence.occurredAt)
    const resolvedAt = readTimestamp(visibleOccurrence.resolvedAt)
    const blockedLogs = logCtx?.getLogsForPhase('BLOCKED_ERROR') ?? []
    const phaseLogs = logCtx?.getLogsForPhase(visibleOccurrence.blockedFromStatus) ?? []
    const merged = mergeErrorLogs(
      filterLogsWithinWindow(phaseLogs, {
        startTime: previousResolutionTime,
        endTime: blockedAt,
        includeStart: false,
      }),
      filterLogsWithinWindow(blockedLogs, {
        startTime: blockedAt,
        endTime: resolvedAt,
      }),
    )
    return merged
  })()

  const isLiveError = !readOnly
    && ticket.status === 'BLOCKED_ERROR'
    && Boolean(visibleOccurrence)
    && visibleOccurrence?.resolvedAt === null
  const canContinue = isLiveError && ticket.availableActions.includes('continue')
  const canRetryWithNote = isLiveError
    && visibleOccurrence?.blockedFromStatus === 'CODING'
    && ticket.availableActions.includes('retry')
  const canIncludeFinalTestFiles = isLiveError && ticket.availableActions.includes(FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION)
  const canDiscardFinalTestFiles = isLiveError && ticket.availableActions.includes(FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION)
  const pausedCodingBead = isLiveError
    && visibleOccurrence?.blockedFromStatus === 'CODING'
    && activeRuntimeBead?.status === 'in_progress'
    ? activeRuntimeBead
    : null
  const diagnostics = visibleOccurrence?.diagnostics ?? null
  const diagnosticRows = diagnostics ? buildDiagnosticRows(diagnostics) : []
  const primaryErrorMessage = visibleOccurrence?.errorMessage || ticket.errorMessage || 'An error occurred but no details were captured. Try retrying or check the server logs.'
  const statusLabelOptions = {
    currentBead: ticket.runtime.currentBead ?? ticket.currentBead,
    totalBeads: ticket.runtime.totalBeads ?? ticket.totalBeads,
  }
  const diagnosticSummary = diagnostics?.summary?.trim() ?? ''
  const normalizedPrimaryError = normalizeErrorText(primaryErrorMessage)
  const normalizedDiagnosticSummary = normalizeErrorText(diagnosticSummary)
  const hasDiagnosticSummary = diagnosticSummary.length > 0
    && normalizedPrimaryError.length > 0
    && !normalizedPrimaryError.includes(normalizedDiagnosticSummary)
  const handleAction = (action: WorkflowAction) => {
    setActionError(null)
    performAction(
      { id: ticket.id, action },
      {
        onError: (error: unknown) => {
          setActionError(error instanceof Error ? error.message : `Failed to ${action} ticket`)
        },
      },
    )
  }
  const retryNoteIsBlank = retryNote.trim().length === 0
  const isRetryNotePending = isPending || retryNoteSubmitting
  const handleRetryWithNote = () => {
    if (retryNoteIsBlank) {
      setRetryNoteError('Enter an extra note before retrying.')
      return
    }

    setRetryNoteError(null)
    setRetryNoteSubmitting(true)
    performAction(
      { id: ticket.id, action: 'retry', note: retryNote },
      {
        onSuccess: () => {
          setRetryNoteSubmitting(false)
          setRetryNoteDialogOpen(false)
          setRetryNote('')
          setRetryNoteError(null)
        },
        onError: (error: unknown) => {
          setRetryNoteSubmitting(false)
          setRetryNoteError(error instanceof Error ? error.message : 'Failed to add note and retry ticket')
        },
      },
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="min-h-0 shrink overflow-y-auto p-4">
        <Card className={isLiveError ? 'border-destructive' : 'border-amber-300 dark:border-amber-800'}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className={`h-4 w-4 ${isLiveError ? 'animate-wobble-throb' : ''}`} />
              {isLiveError ? 'Blocked — Error' : 'Error Review'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {visibleOccurrence ? (
                  <>
                    <Badge variant={isLiveError ? 'destructive' : 'secondary'} className="text-[10px]">
                      {formatErrorOccurrenceStatus(visibleOccurrence, statusLabelOptions)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {formatErrorOccurrenceLabel(visibleOccurrence, visibleOccurrence.occurrenceNumber, statusLabelOptions)}
                    </Badge>
                  </>
                ) : (
                  <Badge variant="destructive" className="text-[10px]">Active</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                                className="flex items-center gap-1"
                                                title={visibleOccurrence?.occurredAt ? formatTimestampString(visibleOccurrence.occurredAt, { includeMilliseconds: false }) : undefined}
                                              >
                                                <Clock3 className="h-3.5 w-3.5" />
                                                {visibleOccurrence ? `Blocked from ${getStatusUserLabel(visibleOccurrence.blockedFromStatus, statusLabelOptions)}` : 'Blocked error'}
                                              </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-center text-balance">{visibleOccurrence?.occurredAt
                                                  ? formatTimestampString(visibleOccurrence.occurredAt, { includeMilliseconds: false })
                                                  : undefined}</TooltipContent>
                              </Tooltip>
                {visibleOccurrence?.resolvedAt && (
                  <span className="flex items-center gap-1">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Resolved {formatTimestamp(visibleOccurrence.resolvedAt, { includeMilliseconds: false })}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground">{primaryErrorMessage}</p>
              {visibleOccurrence?.errorCodes && visibleOccurrence.errorCodes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {visibleOccurrence.errorCodes.map((code) => (
                    <Badge key={code} variant="outline" className="text-[10px]">
                      {code}
                    </Badge>
                  ))}
                </div>
              )}
              {diagnostics && (
                <div className="rounded border border-border bg-background/70 px-2 py-1.5 text-[11px] text-muted-foreground space-y-1.5">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-foreground">
                    <Info className="h-3.5 w-3.5" />
                    Underlying error
                  </div>
                  {hasDiagnosticSummary && (
                    <p className="font-mono whitespace-pre-wrap text-muted-foreground/90">{diagnosticSummary}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                    {diagnosticRows.map((row) => (
                      <div key={`${row.label}:${row.value}`} className="min-w-0">
                        <span className="text-muted-foreground/80">{row.label}: </span>
                        <span className="font-mono text-foreground break-words">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(failedBead || pausedCodingBead || ticket.runtime.activeBeadIteration) && (
                <div className="rounded border border-border bg-background/70 px-2 py-1.5 text-[11px] text-muted-foreground space-y-1">
                  {failedBead && (
                    <div>
                      Failed bead <span className="font-mono text-foreground">{failedBead.id}</span>
                      {ticket.runtime.activeBeadIteration ? ` on iteration ${ticket.runtime.activeBeadIteration}` : ''}
                    </div>
                  )}
                  {!failedBead && pausedCodingBead && (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">Paused</Badge>
                        <span>
                          Bead <span className="font-mono text-foreground">{pausedCodingBead.id}</span>
                          {ticket.runtime.activeBeadIteration ? ` on iteration ${ticket.runtime.activeBeadIteration}` : ''}
                        </span>
                      </div>
                      <div>
                        Timer paused while the ticket is blocked. {canContinue
                          ? 'Continue resumes the preserved OpenCode session with a fresh bead timer.'
                          : 'Retry starts a fresh coding recovery attempt.'}
                      </div>
                    </>
                  )}
                  <div>
                    Retryable: {ticket.availableActions.includes('retry') ? 'yes' : 'no'}
                  </div>
                  {failedBeadNoteGroups.length > 0 && (
                    <div className="space-y-1">
                      {failedBeadNoteGroups.map((group) => (
                        <div key={group.title} className="space-y-1">
                          <div className="text-[10px] uppercase tracking-wider">{group.title}</div>
                          {group.notes.map((note, index) => (
                            <div key={`${note.timestamp}-${note.iteration}-${index}`} className="rounded border border-border/60 p-1.5">
                              <div className="mb-0.5 flex flex-wrap gap-1.5 text-[9px] uppercase tracking-wide">
                                {note.iteration > 0 ? <span>Iteration {note.iteration}</span> : null}
                                {note.timestamp ? <span>{note.timestamp}</span> : null}
                                {note.errorCode ? <span className="font-mono">{note.errorCode}</span> : null}
                              </div>
                              <p className="font-mono text-[10px] whitespace-pre-wrap text-muted-foreground/90">{note.content}</p>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {isLiveError && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isPending}
                    className="h-7 text-xs"
                  >
                    Cancel…
                  </Button>
                  {canContinue && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction('continue')}
                          disabled={isPending}
                          className="h-7 text-xs border-amber-500/70 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                        >
                          <CirclePlay className="mr-1 h-3.5 w-3.5" />
                          Continue
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-center text-balance">
                        Sends only "continue please" to the preserved session. It does not restart the original prompt.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canDiscardFinalTestFiles && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION)}
                          disabled={isPending}
                          className="h-7 text-xs"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Discard and Continue
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-center text-balance">
                        Removes only files the audit proves were produced or changed during final testing.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canIncludeFinalTestFiles && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION)}
                          disabled={isPending}
                          className="h-7 text-xs"
                        >
                          <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                          Include in PR
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-center text-balance">
                        Records an override so integration treats the unclassified final-test files as candidate changes.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {canRetryWithNote && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRetryNoteError(null)
                        setRetryNoteDialogOpen(true)
                      }}
                      disabled={isPending}
                      className="h-7 text-xs"
                    >
                      <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                      Retry with extra note
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleAction('retry')}
                    disabled={isPending}
                    className="h-7 text-xs"
                  >
                    {retryActionLabel}
                  </Button>
                </div>
                {actionError && (
                  <p role="alert" className="text-right text-[11px] leading-snug text-destructive">
                    {actionError}
                  </p>
                )}
                {canContinue && (
                  <p className="text-right text-[11px] leading-snug text-muted-foreground">
                    Continue keeps the current OpenCode session and sends only "continue please" after the temporary interruption clears.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CollapsiblePhaseLogSection
        phase={visibleOccurrence?.blockedFromStatus ?? 'BLOCKED_ERROR'}
        logs={errorLogs}
        ticket={ticket}
        defaultExpanded={false}
        className="px-4 pb-4"
      />

      <Dialog
        open={retryNoteDialogOpen}
        onOpenChange={(open) => {
          if (!isRetryNotePending) setRetryNoteDialogOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry implementation with an extra note</DialogTitle>
            <DialogDescription id="retry-note-description">
              Add guidance for the next fresh implementation attempt. The note will be appended to User Retry Notes; nothing already there will be replaced.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              handleRetryWithNote()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="retry-note" className="text-sm font-medium">
                Extra note <span className="text-destructive">*</span>
              </label>
              <textarea
                id="retry-note"
                value={retryNote}
                onChange={(event) => {
                  setRetryNote(event.target.value.slice(0, MAX_RETRY_NOTE_LENGTH))
                }}
                maxLength={MAX_RETRY_NOTE_LENGTH}
                required
                disabled={isRetryNotePending}
                aria-describedby={`retry-note-description retry-note-count${retryNoteError ? ' retry-note-error' : ''}`}
                aria-invalid={Boolean(retryNoteError || (retryNote.length > 0 && retryNoteIsBlank))}
                className="min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Add context, constraints, or a different approach for the next attempt..."
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  {retryNote.length > 0 && retryNoteIsBlank && !retryNoteError && (
                    <p role="alert" className="text-xs text-destructive">Enter an extra note before retrying.</p>
                  )}
                  {retryNoteError && (
                    <p id="retry-note-error" role="alert" className="text-xs text-destructive">
                      {retryNoteError}
                    </p>
                  )}
                </div>
                <p id="retry-note-count" className="shrink-0 text-xs text-muted-foreground">
                  {retryNote.length.toLocaleString()} / {MAX_RETRY_NOTE_LENGTH.toLocaleString()} characters
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRetryNoteDialogOpen(false)}
                disabled={isRetryNotePending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isRetryNotePending || retryNoteIsBlank}>
                Add note and retry
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <CancelTicketDialog ticketId={ticket.id} open={cancelDialogOpen} onOpenChange={setCancelDialogOpen} />
    </div>
  )
}
