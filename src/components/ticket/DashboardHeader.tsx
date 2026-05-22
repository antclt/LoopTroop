import { useCallback, useRef, useState, useEffect } from 'react'
import { FolderOpen, Copy, Check as CheckIcon, Pencil, HardDrive, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUI } from '@/context/useUI'
import { useTicketAction, useCancelTicket, useUpdateTicket } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProfile } from '@/hooks/useProfile'
import { useProjects } from '@/hooks/useProjects'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { getTicketAvailableActions, getTicketCouncilMembers, getTicketRuntime } from '@/lib/ticketNormalization'
import { getStatusProgress, getStatusRingColor } from '@/components/kanban/ticketCardUtils'
import { ProgressRing } from '@/components/kanban/ProgressRing'
import { EffortBadge } from '@/components/shared/EffortBadge'
import { TicketActions } from './TicketActions'
import { ErrorBanner } from './ErrorBanner'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface DashboardHeaderProps {
  ticket: Ticket
}

function ProjectIcon({
  icon,
  imageClassName,
  emojiClassName,
}: {
  icon?: string | null
  imageClassName: string
  emojiClassName: string
}) {
  if (!icon) return null
  return icon.startsWith('data:')
    ? <img src={icon} className={`${imageClassName} rounded`} alt="" />
    : <span className={emojiClassName} aria-hidden="true">{icon}</span>
}

function getPriorityLabel(priority: number): string {
  const labels: Record<number, string> = { 1: 'Very High', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Very Low' }
  return labels[priority] ?? 'Normal'
}

function getStatusBadgeClasses(status: string): string {
  if (status === 'BLOCKED_ERROR') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
  if (['COMPLETED', 'CANCELED'].includes(status)) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700'
  if (status.startsWith('WAITING_')) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
  return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
}

const NON_CANCELABLE = ['COMPLETED', 'CANCELED']

function CopyablePathRow({ label, path }: { label: string; path: string }) {
  const [copied, handleCopy] = useCopyToClipboard()
  return (
    <div className="col-span-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-0.5 flex items-center gap-1.5 group">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Tooltip>
                <TooltipTrigger asChild>
                  <code className="text-xs font-mono text-muted-foreground truncate flex-1">{path}</code>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center text-balance">{path}</TooltipContent>
              </Tooltip>
        <Tooltip>
                <TooltipTrigger asChild>
                  <button
                        type="button"
                        onClick={() => handleCopy(path)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-muted"
                      >
                        {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                      </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center text-balance">Copy path</TooltipContent>
              </Tooltip>
      </div>
    </div>
  )
}

function CopyableDescription({ description }: { description: string }) {
  const [copied, handleCopy] = useCopyToClipboard()

  return (
    <div className="col-span-2 border-t-[2px] border-border/70 pt-2 mt-1">
      <div className="flex items-center justify-between group">
        <span className="text-xs font-medium text-muted-foreground">Description</span>
        <Tooltip>
                <TooltipTrigger asChild>
                  <button
                        type="button"
                        onClick={() => handleCopy(description)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-muted"
                      >
                        {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                      </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center text-balance">Copy description</TooltipContent>
              </Tooltip>
      </div>
      <div className="mt-1 rounded-md border border-border/50 bg-muted/30 p-3">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export function DashboardHeader({ ticket }: DashboardHeaderProps) {
  const { dispatch } = useUI()
  const { isPending } = useTicketAction()
  const { mutate: cancelTicket, isPending: isCancelPending } = useCancelTicket()
  const { mutateAsync: updateTicket } = useUpdateTicket()
  const { data: profile } = useProfile()
  const [showDetails, setShowDetails] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [deleteContent, setDeleteContent] = useState(false)
  const [deleteLog, setDeleteLog] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(ticket.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isCalculatingSize, setIsCalculatingSize] = useState(false)
  const [ticketSize, setTicketSize] = useState<number | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)

  const handleCalculateSize = async () => {
    setIsCalculatingSize(true)
    setSizeError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/size`)
      if (!res.ok) throw new Error('Failed to calculate size')
      const data = await res.json()
      setTicketSize(data.size)
    } catch (err) {
      setSizeError(err instanceof Error ? err.message : 'Error calculating size')
    } finally {
      setIsCalculatingSize(false)
    }
  }

  useEffect(() => {
    setTitleDraft(ticket.title)
  }, [ticket.title])

  useEffect(() => {
    setTicketSize(null)
    setSizeError(null)
  }, [ticket.id])

  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditingTitle])

  const handleSaveTitle = async () => {
    if (titleDraft.trim() && titleDraft !== ticket.title) {
      try {
        await updateTicket({ id: ticket.id, title: titleDraft.trim() })
      } catch {
        setTitleDraft(ticket.title)
      }
    } else {
      setTitleDraft(ticket.title)
    }
    setIsEditingTitle(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSaveTitle()
    if (e.key === 'Escape') {
      setTitleDraft(ticket.title)
      setIsEditingTitle(false)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowBottomFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])
  const detailsScrollInit = useCallback(() => {
    setShowBottomFade(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => handleScroll())
    })
  }, [handleScroll])
  const runtime = getTicketRuntime(ticket)
  const availableActions = getTicketAvailableActions(ticket)
  const lockedCouncilMembers = getTicketCouncilMembers(ticket)
  const canCancel = availableActions.includes('cancel')
  const canDelete = NON_CANCELABLE.includes(ticket.status)
  const isActionPending = isPending || isCancelPending
  const isDraft = ticket.status === 'DRAFT'
  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === ticket.projectId)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: runtime.currentBead,
    totalBeads: runtime.totalBeads,
    errorMessage: ticket.errorMessage,
  })
  const progress = getStatusProgress(ticket.status)
  const ringColor = getStatusRingColor(ticket.status)
  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <ProjectIcon icon={project?.icon} imageClassName="h-4 w-4" emojiClassName="text-sm" />
            <span className="font-mono text-sm font-semibold" style={{ color: project?.color ?? undefined }}>{ticket.externalId}</span>
          </div>
          {isEditingTitle ? (
            <input
              ref={inputRef}
              className="text-base font-semibold truncate w-full max-w-[400px] bg-transparent border-b border-primary outline-none focus:ring-0 px-0.5 py-0"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveTitle}
            />
          ) : (
            <div className="flex items-center gap-1.5 group min-w-0">
              <h2 className="text-base font-semibold truncate max-w-[400px]">{ticket.title}</h2>
              {ticket.status === 'DRAFT' && (
                <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                                    type="button"
                                                    onClick={() => setIsEditingTitle(true)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded shrink-0"
                                                    aria-label="Edit title"
                                                  >
                                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                                  </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs text-center text-balance">Edit Title</TooltipContent>
                                  </Tooltip>
              )}
            </div>
          )}
          <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className={`text-xs shrink-0 ${getStatusBadgeClasses(ticket.status)}`}>
                              {statusLabel}
                            </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-center text-balance">Current workflow phase</TooltipContent>
                  </Tooltip>
        </div>
        <TicketActions
          ticket={ticket}
          canCancel={canCancel}
          canDelete={canDelete}
          isPending={isActionPending}
          cancelLabel={isDraft ? 'Cancel' : 'Cancel…'}
          onShowDetails={() => setShowDetails(true)}
          onCancelConfirm={isDraft
            ? () => { cancelTicket({ id: ticket.id, options: { deleteContent: false, deleteLog: false } }) }
            : () => setShowCancelConfirm(true)
          }
          onClose={() => dispatch({ type: 'CLOSE_TICKET' })}
        />
      </div>

      <Dialog open={showDetails} onOpenChange={(open) => { setShowDetails(open); if (open) detailsScrollInit() }}>
        <DialogContent closeButtonVariant="dashboard" className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Ticket Details</DialogTitle>
            <DialogDescription className="sr-only">
              Review ticket metadata, project details, file locations, and the current description.
            </DialogDescription>
          </DialogHeader>
          <div className="relative flex-1 min-h-0 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="grid grid-cols-2 gap-3 text-sm overflow-y-auto pr-1 max-h-[calc(80vh-6rem)] [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:var(--border)_transparent]"
          >
            <div className={project ? '' : 'col-span-2'}>
              <span className="text-xs font-medium text-muted-foreground">Title</span>
              <p className="mt-0.5 font-medium [overflow-wrap:anywhere]">{ticket.title}</p>
            </div>
            {project && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Project</span>
                <div className="mt-0.5 flex items-center gap-2 min-w-0">
                  <ProjectIcon icon={project.icon} imageClassName="h-4 w-4" emojiClassName="text-sm leading-none" />
                  <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="truncate font-medium">{project.name}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-center text-balance">{project.name}</TooltipContent>
                                      </Tooltip>
                </div>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-muted-foreground">External ID</span>
              <p className="font-mono mt-0.5">{ticket.externalId}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <p className="mt-0.5">P{ticket.priority} — {getPriorityLabel(ticket.priority)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Created</span>
              <p className="mt-0.5">{new Date(ticket.createdAt).toLocaleString()}</p>
            </div>
            {ticket.status !== 'DRAFT' ? (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Last Updated</span>
                <p className="mt-0.5">{ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : 'N/A'}</p>
              </div>
            ) : <div />}
            {ticket.status !== 'DRAFT' && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Started At</span>
                <p className="mt-0.5">{ticket.startedAt ? new Date(ticket.startedAt).toLocaleString() : '—'}</p>
              </div>
            )}
            {ticket.startedAt && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Duration</span>
                <p className="mt-0.5">{(() => {
                  const start = new Date(ticket.startedAt).getTime()
                  const end = ['COMPLETED', 'CANCELED', 'BLOCKED_ERROR'].includes(ticket.status)
                    ? new Date(ticket.updatedAt).getTime()
                    : Date.now()
                  const diffMs = end - start
                  const mins = Math.floor(diffMs / 60000)
                  if (mins < 60) return `${mins}m`
                  const hrs = Math.floor(mins / 60)
                  return `${hrs}h ${mins % 60}m`
                })()}</p>
              </div>
            )}
            <div className="col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={ticket.status !== 'DRAFT' ? getStatusBadgeClasses(ticket.status).replace('bg-', 'text-').split(' ').filter(c => c.startsWith('text-')).join(' ') : ''}>
                  {statusLabel}
                </span>
                {ticket.status !== 'DRAFT' && progress !== null && (
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
            </div>
            {(() => {
              const isDraft = ticket.status === 'DRAFT'
              const mainModel = isDraft ? profile?.mainImplementer ?? null : ticket.lockedMainImplementer
              const mainVariant = isDraft ? (profile?.mainImplementerVariant ?? null) : ticket.lockedMainImplementerVariant
              const rawCouncilVariants = isDraft
                ? (profile?.councilMemberVariants ? JSON.parse(profile.councilMemberVariants) as Record<string, string> : {})
                : (ticket.lockedCouncilMemberVariants ?? {})
              const rawMembers: string[] = isDraft
                ? (profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [])
                : lockedCouncilMembers
              const otherMembers = (rawMembers.length > 0 && rawMembers[0] === mainModel) ? rawMembers.slice(1) : rawMembers
              if (!mainModel && otherMembers.length === 0) return null
              return (
                <div className="col-span-2 border-t-[4px] border-border pt-2 mt-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isDraft ? 'Current Council' : 'Models Selected'}
                  </span>
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {mainModel && (
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col space-y-1">
                          <span>Main Implementer</span>
                          <span>Council Member A</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {mainVariant && <EffortBadge variant={mainVariant} />}
                          <span className="font-mono text-right">{mainModel}</span>
                        </div>
                      </div>
                    )}
                    {otherMembers.length > 0 && (
                      <>
                        <div className="my-2 border-t-[2px] border-border/70" />
                        {otherMembers.map((member, index) => (
                          <div key={member} className="flex justify-between">
                            <span>Council Member {String.fromCharCode(66 + index)}</span>
                            <div className="flex items-center gap-2">
                              {rawCouncilVariants[member] && <EffortBadge variant={rawCouncilVariants[member]} />}
                              <span className="font-mono">{member}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )
            })()}
            {ticket.branchName && (
              <div className="col-span-2 border-t-[4px] border-border pt-2 mt-1 flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">Branch / Worktree</span>
                  <p className="font-mono mt-0.5 break-all">{ticket.branchName}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs font-medium text-muted-foreground">Base Branch</span>
                  <p className="font-mono mt-0.5">{runtime.baseBranch}</p>
                </div>
              </div>
            )}
            {runtime.totalBeads > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Beads</span>
                <p className="mt-0.5">{runtime.completedBeads} / {runtime.totalBeads}</p>
              </div>
            )}
            {runtime.totalBeads > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Completion</span>
                <p className="mt-0.5">{Math.round(runtime.percentComplete)}%</p>
              </div>
            )}
            {runtime.activeBeadIteration && runtime.activeBeadIteration > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Active Iteration</span>
                <p className="mt-0.5">
                  {runtime.activeBeadIteration}
                  {runtime.maxIterationsPerBead && runtime.maxIterationsPerBead > 0 ? ` / ${runtime.maxIterationsPerBead}` : ''}
                  {runtime.activeBeadId ? ` (${runtime.activeBeadId})` : ''}
                </p>
              </div>
            )}
            {!ticket.branchName && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Base Branch</span>
                <p className="font-mono mt-0.5">{runtime.baseBranch}</p>
              </div>
            )}
            {runtime.candidateCommitSha && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Candidate Commit</span>
                <p className="font-mono mt-0.5">{runtime.candidateCommitSha}</p>
              </div>
            )}
            {ticket.errorMessage && (
              <ErrorBanner errorMessage={ticket.errorMessage} />
            )}
            {project && ticket.status !== 'DRAFT' && (
              <div className="col-span-2 border-t-[2px] border-border/70 pt-2 mt-1 flex flex-col gap-2.5">
                <CopyablePathRow label="Artifacts Location" path={runtime.artifactRoot || `${project.folderPath}/.looptroop/worktrees/${ticket.externalId}`} />
                <div className="bg-muted/30 border border-border/50 rounded-lg p-3 mt-1 shadow-inner relative overflow-hidden group">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-indigo-500" />
                      Ticket Disk Space
                    </span>
                    {ticketSize !== null && (
                      <button
                        type="button"
                        onClick={handleCalculateSize}
                        disabled={isCalculatingSize}
                        className="text-xs text-indigo-500 hover:text-indigo-400 font-medium transition-colors flex items-center gap-1.5 focus:outline-none"
                      >
                        <RotateCw className={`h-3 w-3 ${isCalculatingSize ? 'animate-spin' : ''}`} />
                        Recalculate
                      </button>
                    )}
                  </div>

                  {ticketSize === null ? (
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-[11px] text-muted-foreground leading-normal max-w-[340px]">
                        Calculate the exact size occupied on disk by this ticket's isolated git worktree, branches, artifacts, and execution logs.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isCalculatingSize}
                        onClick={handleCalculateSize}
                        className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white font-medium shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center gap-1.5 h-8 px-3.5 rounded-md text-xs shrink-0"
                      >
                        {isCalculatingSize ? (
                          <>
                            <RotateCw className="h-3.5 w-3.5 animate-spin" />
                            Calculating...
                          </>
                        ) : (
                          <>
                            <HardDrive className="h-3.5 w-3.5" />
                            Calculate Size
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 py-0.5 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg shrink-0 flex items-center justify-center shadow-sm">
                        <HardDrive className="h-5 w-5 text-indigo-500 animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xl font-extrabold text-foreground font-mono leading-none tracking-tight">
                            {formatBytes(ticketSize)}
                          </span>
                          <span className="text-[9px] text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider leading-none">
                            Occupied
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          Includes repository code, phase artifacts, and execution logs.
                        </p>
                      </div>
                    </div>
                  )}

                  {sizeError && (
                    <div className="mt-2 text-xs text-red-500 border-t border-red-500/20 pt-1.5 flex items-center gap-1.5 animate-in fade-in duration-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                      {sizeError}
                    </div>
                  )}
                </div>
              </div>
            )}
            {ticket.description && (
              <CopyableDescription description={ticket.description} />
            )}
          </div>
          {showBottomFade && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCancelConfirm}
        onOpenChange={(open) => {
          setShowCancelConfirm(open)
          if (!open) {
            setDeleteContent(false)
            setDeleteLog(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Ticket</DialogTitle>
            <DialogDescription className="sr-only">
              Confirm cancellation and choose optional cleanup actions.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The ticket will be stopped and moved to Canceled. No further AI execution will occur.
            Artifacts generated up to this point are preserved by default.
          </p>
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background accent-destructive cursor-pointer"
                checked={deleteContent}
                onChange={(e) => setDeleteContent(e.target.checked)}
                data-testid="delete-content-checkbox"
              />
              <span className="text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
                <span className="font-medium text-foreground">Delete AI-generated artifacts and worktree</span>
                <br />
                Permanently removes all AI-generated content stored for this ticket — interview questions and answers, PRD drafts, beads plan entries — and deletes the isolated git worktree including its branch and any code written to it. This cannot be undone.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background accent-destructive cursor-pointer"
                checked={deleteLog}
                onChange={(e) => setDeleteLog(e.target.checked)}
                data-testid="delete-log-checkbox"
              />
              <span className="text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
                <span className="font-medium text-foreground">Delete execution log</span>
                <br />
                Permanently removes both persisted execution logs: the normal phase log and the debug/forensic log. The log viewer will show no history for this ticket after deletion.
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCancelConfirm(false)
                setDeleteContent(false)
                setDeleteLog(false)
              }}
            >
              Keep Ticket
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isCancelPending}
              onClick={() => {
                cancelTicket({ id: ticket.id, options: { deleteContent, deleteLog } })
                setShowCancelConfirm(false)
                setDeleteContent(false)
                setDeleteLog(false)
              }}
            >
              Yes, Cancel Ticket
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
