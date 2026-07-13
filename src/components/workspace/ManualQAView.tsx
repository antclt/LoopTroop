import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, RefreshCw, Save, ShieldCheck, SkipForward, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingText } from '@/components/ui/LoadingText'
import type { Ticket } from '@/hooks/useTickets'
import { useSaveTicketUIState, useTicketUIState } from '@/hooks/useTickets'
import {
  manualQaEvidenceUrl,
  newManualQaActionId,
  useManualQaIndex,
  useManualQaRound,
  useRemoveManualQaEvidence,
  useResolveManualQaDrift,
  useSkipManualQa,
  useSubmitManualQa,
  useUploadManualQaEvidence,
  type ManualQaDraft,
  type ManualQaItemResult,
  type ManualQaResultStatus,
  type ManualQaSummary,
} from '@/hooks/useManualQA'
import { cn } from '@/lib/utils'
import { flushTicketUiStateSnapshot } from '@/components/workspace/approvalHooks'
import { buildCanonicalManualQaDraft, buildDefaultManualQaImprovementContext, composeManualQaImprovementPreview, validateManualQaItem } from '@/lib/manualQaDraft'

interface ManualQAViewProps {
  ticket: Ticket
  readOnly?: boolean
}

interface PendingEvidenceUpload {
  key: string
  version: number
  file: File
  message: string
}

const RESULT_OPTIONS: Array<{ value: ManualQaResultStatus; label: string; className: string }> = [
  { value: 'pass', label: 'Pass', className: 'data-[selected=true]:border-green-500 data-[selected=true]:bg-green-500/10 data-[selected=true]:text-green-700 dark:data-[selected=true]:text-green-300' },
  { value: 'fail', label: 'Fail', className: 'data-[selected=true]:border-red-500 data-[selected=true]:bg-red-500/10 data-[selected=true]:text-red-700 dark:data-[selected=true]:text-red-300' },
  { value: 'waive', label: 'Waive', className: 'data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-500/10 data-[selected=true]:text-amber-700 dark:data-[selected=true]:text-amber-300' },
  { value: 'improvement', label: 'Improvement', className: 'data-[selected=true]:border-blue-500 data-[selected=true]:bg-blue-500/10 data-[selected=true]:text-blue-700 dark:data-[selected=true]:text-blue-300' },
  { value: 'pending', label: 'Pending', className: 'data-[selected=true]:bg-muted data-[selected=true]:text-foreground' },
]

const SAFE_RASTER_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

function emptyDraft(): ManualQaDraft {
  return { results: {} }
}

function resultFor(draft: ManualQaDraft, itemId: string): ManualQaItemResult {
  return draft.results[itemId] ?? { itemId, status: 'pending', evidenceIds: [] }
}

function getUiRevision(state: unknown, fallback: number) {
  if (!state || typeof state !== 'object') return fallback
  const record = state as Record<string, unknown>
  for (const value of [record.revision, record.serverRevision, record.clientRevision]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

function extractSavedDraft(value: unknown): ManualQaDraft | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { draft?: unknown }).draft ?? value
  if (!candidate || typeof candidate !== 'object') return null
  const results = (candidate as { results?: unknown }).results
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null
  return candidate as ManualQaDraft
}

function evidenceSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function durationLabel(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function ManualQaRoundSummary({ summary }: { summary: ManualQaSummary }) {
  const counts = summary.itemCounts
  return (
    <Card className="border-primary/30">
      <CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-sm">Round summary <Badge variant="outline">{summary.outcome.replace(/_/g, ' ')}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-3 text-xs">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-muted-foreground">Checks</dt><dd>{summary.requiredItemCount} required · {summary.optionalItemCount} optional</dd>
          <dt className="text-muted-foreground">Results</dt><dd>{counts.pass} passed · {counts.fail} failed · {counts.waive} waived · {counts.improvement} improvements · {counts.pending} pending</dd>
          <dt className="text-muted-foreground">Evidence</dt><dd>{summary.evidenceCount} file{summary.evidenceCount === 1 ? '' : 's'}</dd>
          <dt className="text-muted-foreground">Duration</dt><dd>{durationLabel(summary.durationMs)}</dd>
          <dt className="text-muted-foreground">Coverage</dt><dd>{summary.coverage.covered} full · {summary.coverage.partiallyCovered} partial · {summary.coverage.uncovered} uncovered</dd>
          <dt className="text-muted-foreground">Next action</dt><dd>{summary.nextAction?.replace(/_/g, ' ') ?? 'Recorded'}</dd>
          {summary.startedAt && <><dt className="text-muted-foreground">Started</dt><dd>{new Date(summary.startedAt).toLocaleString()}</dd></>}
          {summary.completedAt && <><dt className="text-muted-foreground">Completed</dt><dd>{new Date(summary.completedAt).toLocaleString()}</dd></>}
        </dl>
        {summary.waivedItems.length > 0 && <div><p className="font-medium">Waivers</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{summary.waivedItems.map((item) => <li key={item.itemId}><code>{item.itemId}</code>: {item.reason}</li>)}</ul></div>}
        {summary.skipReason && <p><span className="font-medium">Skip reason:</span> {summary.skipReason}</p>}
        {summary.createdFixBeadIds.length > 0 && <p><span className="font-medium">Fix beads:</span> <span className="font-mono">{summary.createdFixBeadIds.join(', ')}</span></p>}
        {summary.improvementTicketIds.length > 0 && <p><span className="font-medium">Improvement tickets:</span> <span className="font-mono">{summary.improvementTicketIds.join(', ')}</span></p>}
        {summary.modelCapability && <p className="text-muted-foreground">Evidence delivery: {summary.modelCapability.imageEvidenceMode.replace('_', ' ')} · model {summary.modelCapability.modelId ?? 'unavailable'}{summary.modelCapability.modelVariant ? ` (${summary.modelCapability.modelVariant})` : ''}</p>}
        {summary.message && <p className="text-muted-foreground">{summary.message}</p>}
      </CardContent>
    </Card>
  )
}

function ManualQaGeneration({ versions, onSelectVersion }: {
  versions: Array<{ version: number; outcome?: string | null; status: string }>
  onSelectVersion: (version: number) => void
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-xl">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div>
            <h3 className="font-semibold">Preparing your Manual QA checklist</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              LoopTroop is generating user-run verification steps from the approved ticket, final tests, and focused implementation evidence. No action is needed, and LoopTroop will not start or control your application.
            </p>
          </div>
          {versions.length > 0 && (
            <div className="w-full border-t border-border pt-4">
              <p className="mb-2 text-xs text-muted-foreground">Previous rounds remain available while the next checklist is generated.</p>
              <select
                aria-label="Open historical Manual QA round"
                defaultValue=""
                onChange={(event) => event.target.value && onSelectVersion(Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="" disabled>Open a previous round…</option>
                {versions.map((entry) => <option key={entry.version} value={entry.version}>Round v{entry.version} · {entry.outcome ?? entry.status}</option>)}
              </select>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function ManualQAView({ ticket, readOnly = false }: ManualQAViewProps) {
  const isGenerating = ticket.status === 'GENERATING_QA_CHECKLIST'
  const { data: index, isLoading: indexLoading, error: indexError } = useManualQaIndex(ticket.id)
  const projectedVersion = ticket.manualQa?.activeVersion ?? null
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const activeVersion = index?.activeVersion ?? projectedVersion
  const version = selectedVersion ?? activeVersion ?? index?.versions.at(-1)?.version ?? null
  // A generation reservation exposes its version before checklist.yaml exists.
  // Do not cache that expected pre-artifact 404; historical rounds remain selectable.
  const roundQuery = useManualQaRound(ticket.id, version, !isGenerating || selectedVersion !== null)
  const { data: round, isLoading: roundLoading, error: roundError } = roundQuery
  const scope = version === null ? 'manual_qa_draft:none' : `manual_qa_draft:v${version}`
  const uiState = useTicketUIState<ManualQaDraft>(ticket.id, scope, version !== null)
  const saveUiState = useSaveTicketUIState()
  const submit = useSubmitManualQa()
  const skip = useSkipManualQa()
  const includeDrift = useResolveManualQaDrift('include')
  const discardDrift = useResolveManualQaDrift('discard')
  const uploadEvidence = useUploadManualQaEvidence()
  const removeEvidence = useRemoveManualQaEvidence()
  const [draft, setDraft] = useState<ManualQaDraft>(emptyDraft)
  const [draftSourceKey, setDraftSourceKey] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const [skipOpen, setSkipOpen] = useState(false)
  const [improvementItemId, setImprovementItemId] = useState<string | null>(null)
  const [linkDrafts, setLinkDrafts] = useState<Record<string, { url: string; label: string; error?: string }>>({})
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string | undefined>>({})
  const [pendingEvidenceUploads, setPendingEvidenceUploads] = useState<Record<string, PendingEvidenceUpload[]>>({})
  const [driftError, setDriftError] = useState<string | null>(null)
  const [removingEvidenceIds, setRemovingEvidenceIds] = useState<Set<string>>(new Set())
  const draftRef = useRef(draft)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const latestDraftRevisionRef = useRef(0)
  const operationActionIdsRef = useRef(new Map<string, string>())
  const mutationIdentitiesRef = useRef(new Map<string, string>())
  const evidenceIdsRef = useRef(new Map<string, string>())
  draftRef.current = draft

  const historical = Boolean(version !== null && activeVersion !== null && version !== activeVersion)
    || round?.readOnly === true
    || readOnly
  const submissionInProgress = Boolean(
    !historical
    && round?.operation?.actionId
    && round.operation.status !== 'complete',
  )
  const resumableOperationType = submissionInProgress ? (round?.operation?.operationType ?? 'submit') : null
  const editable = !historical && !submissionInProgress
  const checklist = round?.checklist
  const checklistHash = round?.checklistHash ?? ''
  const expectedDraftRevision = Math.max(
    getUiRevision(uiState.data, 0),
    round?.draftRevision ?? 0,
  )
  const items = useMemo(() => checklist?.items ?? [], [checklist?.items])

  useEffect(() => {
    if (!round || version === null) return
    const key = `${version}:${round.checklistHash ?? ''}`
    if (draftSourceKey === key) return
    const restored = extractSavedDraft(uiState.data?.data) ?? round.draft ?? emptyDraft()
    setDraft(restored)
    setSkipReason(restored.skipReason ?? '')
    setDraftSourceKey(key)
    setDirty(false)
    setSaveState('idle')
  }, [draftSourceKey, round, uiState.data?.data, version])

  useEffect(() => {
    latestDraftRevisionRef.current = expectedDraftRevision
  }, [expectedDraftRevision, version])

  const persistDraft = useCallback((keepalive = false) => {
    if (!editable || version === null || !dirty) {
      return saveState === 'conflict'
        ? Promise.reject(new Error('Manual QA draft conflict; reload the latest draft before continuing.'))
        : Promise.resolve()
    }
    if (!keepalive) setSaveState('saving')
    const current = draftRef.current
    const run = async () => {
      if (keepalive) {
        flushTicketUiStateSnapshot(ticket.id, scope, current)
        return false
      }
      const saved = await saveUiState.mutateAsync({ ticketId: ticket.id, scope, data: current })
      if (saved.conflict) throw new Error('Manual QA draft conflict')
      latestDraftRevisionRef.current = saved.revision
      return true
    }
    const pending = saveQueueRef.current.then(run, run).then((confirmed) => {
      if (confirmed) {
        if (draftRef.current === current) setDirty(false)
        setSaveState('saved')
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      setSaveState(message.includes('conflict') || message.includes('stale') ? 'conflict' : 'error')
      throw error
    })
    saveQueueRef.current = pending.catch(() => undefined)
    return pending
  }, [dirty, editable, saveState, saveUiState, scope, ticket.id, version])

  useEffect(() => {
    if (!dirty || !editable) return
    const timer = window.setTimeout(() => { void persistDraft() }, 5000)
    return () => window.clearTimeout(timer)
  }, [dirty, editable, persistDraft])

  useEffect(() => {
    const flush = () => { void persistDraft(true) }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [persistDraft])

  const updateResult = useCallback((itemId: string, patch: Partial<ManualQaItemResult>) => {
    setDraft((current) => {
      const existing = resultFor(current, itemId)
      return {
        ...current,
        results: { ...current.results, [itemId]: { ...existing, ...patch, itemId } },
      }
    })
    setDirty(true)
    setSaveState('idle')
  }, [])

  const appendEvidenceId = useCallback((itemId: string, evidenceId: string) => {
    setDraft((current) => {
      const existing = resultFor(current, itemId)
      return {
        ...current,
        results: {
          ...current.results,
          [itemId]: { ...existing, evidenceIds: [...new Set([...(existing.evidenceIds ?? []), evidenceId])] },
        },
      }
    })
    setDirty(true)
    setSaveState('idle')
  }, [])

  const validation = useMemo(() => Object.fromEntries(
    items.map((item) => [item.id, validateManualQaItem(item, resultFor(draft, item.id))]),
  ), [draft, items])
  const allErrors = Object.values(validation).flat()
  const hasFailures = items.some((item) => resultFor(draft, item.id).status === 'fail')
  const incompleteRequired = items.filter((item) => item.severity === 'required' && resultFor(draft, item.id).status === 'pending').length
  const improvementItem = items.find((item) => item.id === improvementItemId) ?? null
  const coverageSourceItemTotal = round ? Object.values(round.coverageSummary.sourceItemCounts).reduce((sum, count) => sum + count, 0) : 0

  const mutationBase = useCallback((actionId = newManualQaActionId('manual-qa')) => ({
    ticketId: ticket.id,
    version: version!,
    actionId,
    expectedChecklistHash: checklistHash,
    expectedDraftRevision: latestDraftRevisionRef.current,
  }), [checklistHash, ticket.id, version])

  const stableMutationBase = useCallback((key: string, prefix: string) => {
    const actionId = mutationIdentitiesRef.current.get(key) ?? newManualQaActionId(prefix)
    mutationIdentitiesRef.current.set(key, actionId)
    // Action identity is stable, but CAS guards are intentionally read fresh on
    // every retry so a newer autosave revision cannot strand a pending action.
    return mutationBase(actionId)
  }, [mutationBase])

  const rememberRefetchedRevision = useCallback((refreshedRound: typeof round) => {
    if (typeof refreshedRound?.draftRevision === 'number') {
      latestDraftRevisionRef.current = refreshedRound.draftRevision
    }
  }, [])

  const clearPendingEvidenceUpload = useCallback((itemId: string, key: string) => {
    setPendingEvidenceUploads((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? []).filter((entry) => entry.key !== key),
    }))
  }, [])

  const retainPendingEvidenceUpload = useCallback((itemId: string, pending: PendingEvidenceUpload) => {
    setPendingEvidenceUploads((current) => {
      const entries = current[itemId] ?? []
      const index = entries.findIndex((entry) => entry.key === pending.key)
      const next = [...entries]
      if (index >= 0) next[index] = pending
      else next.push(pending)
      return { ...current, [itemId]: next }
    })
  }, [])

  const dismissPendingEvidenceUpload = useCallback((itemId: string, key: string) => {
    clearPendingEvidenceUpload(itemId, key)
    mutationIdentitiesRef.current.delete(key)
    evidenceIdsRef.current.delete(key)
  }, [clearPendingEvidenceUpload])

  const resolveDrift = async (decision: 'include' | 'discard') => {
    if (version === null) return
    const key = `drift:${version}:${decision}`
    setDriftError(null)
    try {
      const mutation = decision === 'include' ? includeDrift : discardDrift
      await mutation.mutateAsync(stableMutationBase(key, `manual-qa-drift-${decision}`))
      mutationIdentitiesRef.current.delete(key)
    } catch (error) {
      const refreshed = await roundQuery.refetch()
      rememberRefetchedRevision(refreshed.data)
      if (refreshed.data?.workspaceDrift?.detected !== true) {
        mutationIdentitiesRef.current.delete(key)
        return
      }
      setDriftError(error instanceof Error ? error.message : `Failed to ${decision} workspace drift.`)
    }
  }

  const uploadEvidenceFile = async (itemId: string, file: File, key: string) => {
    if (version === null) return
    const base = stableMutationBase(key, 'manual-qa-evidence-upload')
    const evidenceId = evidenceIdsRef.current.get(key) ?? newManualQaActionId('evidence')
    evidenceIdsRef.current.set(key, evidenceId)
    try {
      const saved = await uploadEvidence.mutateAsync({ ...base, itemId, file, evidenceId })
      appendEvidenceId(itemId, saved.id)
      clearPendingEvidenceUpload(itemId, key)
      mutationIdentitiesRef.current.delete(key)
      evidenceIdsRef.current.delete(key)
      return null
    } catch (error) {
      const refreshed = await roundQuery.refetch()
      rememberRefetchedRevision(refreshed.data)
      const reconciled = refreshed.data?.evidence.find((entry) => entry.id === evidenceId && entry.itemId === itemId)
      if (reconciled) {
        appendEvidenceId(itemId, reconciled.id)
        clearPendingEvidenceUpload(itemId, key)
        mutationIdentitiesRef.current.delete(key)
        evidenceIdsRef.current.delete(key)
        return null
      }
      retainPendingEvidenceUpload(itemId, {
        key,
        version,
        file,
        message: error instanceof Error ? error.message : 'Upload failed',
      })
    }
  }

  const removeEvidenceFile = async (itemId: string, evidenceId: string) => {
    if (version === null) return
    const key = `remove:${version}:${itemId}:${evidenceId}`
    setEvidenceErrors((current) => ({ ...current, [itemId]: undefined }))
    setRemovingEvidenceIds((current) => new Set(current).add(evidenceId))
    try {
      await removeEvidence.mutateAsync({ ...stableMutationBase(key, 'manual-qa-evidence-remove'), itemId, evidenceId })
      mutationIdentitiesRef.current.delete(key)
      updateResult(itemId, { evidenceIds: (resultFor(draftRef.current, itemId).evidenceIds ?? []).filter((id) => id !== evidenceId) })
    } catch (error) {
      const refreshed = await roundQuery.refetch()
      rememberRefetchedRevision(refreshed.data)
      const stillExists = refreshed.data?.evidence.some((entry) => entry.id === evidenceId && entry.itemId === itemId)
      if (!stillExists) {
        mutationIdentitiesRef.current.delete(key)
        updateResult(itemId, { evidenceIds: (resultFor(draftRef.current, itemId).evidenceIds ?? []).filter((id) => id !== evidenceId) })
      } else {
        setEvidenceErrors((current) => ({ ...current, [itemId]: `${error instanceof Error ? error.message : 'Removal failed'}. Retry keeps the same action identity with the latest draft revision.` }))
      }
    } finally {
      setRemovingEvidenceIds((current) => {
        const next = new Set(current)
        next.delete(evidenceId)
        return next
      })
    }
  }

  const resumableActionId = useCallback((kind: 'submit' | 'skip') => {
    const key = `${version}:${kind}`
    const journalActionId = round?.operation?.status !== 'complete'
      && (round?.operation?.operationType ?? 'submit') === kind
      ? round?.operation?.actionId
      : undefined
    if (journalActionId) operationActionIdsRef.current.set(key, journalActionId)
    const existing = operationActionIdsRef.current.get(key)
    if (existing) return existing
    const created = newManualQaActionId(`manual-qa-${kind}`)
    operationActionIdsRef.current.set(key, created)
    return created
  }, [round?.operation?.actionId, round?.operation?.operationType, round?.operation?.status, version])

  const reloadConflictingDraft = async () => {
    const refreshed = await uiState.refetch()
    const restored = extractSavedDraft(refreshed.data?.data) ?? round?.draft ?? emptyDraft()
    setDraft(restored)
    setSkipReason(restored.skipReason ?? '')
    latestDraftRevisionRef.current = getUiRevision(refreshed.data, round?.draftRevision ?? 0)
    setDirty(false)
    setSaveState('idle')
    setSubmitError(null)
  }

  const handleSubmit = async () => {
    if (version === null || allErrors.length > 0 || !round) return
    setSubmitError(null)
    try {
      await persistDraft()
      const canonicalDraft = buildCanonicalManualQaDraft(ticket.externalId, round, draftRef.current, latestDraftRevisionRef.current)
      await submit.mutateAsync({ ...mutationBase(resumableActionId('submit')), draft: canonicalDraft })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Manual QA submission failed.')
    }
  }

  const handleSkip = async () => {
    if (version === null || !round || (submissionInProgress && resumableOperationType !== 'skip')) return
    setSubmitError(null)
    if (submissionInProgress) {
      try {
        const canonicalDraft = buildCanonicalManualQaDraft(ticket.externalId, round, draftRef.current, latestDraftRevisionRef.current)
        await skip.mutateAsync({ ...mutationBase(resumableActionId('skip')), reason: skipReason.trim() || undefined, draft: canonicalDraft })
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Manual QA skip recovery failed.')
      }
      return
    }
    const skippedDraft = { ...draft, skipReason: skipReason.trim() || undefined }
    setDraft(skippedDraft)
    try {
      const saved = await saveUiState.mutateAsync({ ticketId: ticket.id, scope, data: skippedDraft })
      if (saved.conflict) throw new Error('Manual QA draft conflict')
      latestDraftRevisionRef.current = saved.revision
      const canonicalDraft = buildCanonicalManualQaDraft(ticket.externalId, round, skippedDraft, saved.revision)
      await skip.mutateAsync({ ...mutationBase(resumableActionId('skip')), reason: skipReason.trim() || undefined, draft: canonicalDraft })
      setSkipOpen(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Manual QA skip failed.')
    }
  }

  if (indexLoading || (isGenerating && selectedVersion === null) || (version !== null && roundLoading)) {
    return <ManualQaGeneration versions={(index?.versions ?? []).filter((entry) => entry.version !== activeVersion)} onSelectVersion={setSelectedVersion} />
  }

  const error = indexError ?? roundError
  if (error || !round || !checklist || version === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <p className="mt-3 font-medium">Manual QA artifacts are not available yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'The checklist may still be restoring.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Manual QA · Round v{version}</h3>
              {historical && <Badge variant="secondary">Read only</Badge>}
              {round.outcome && <Badge variant="outline">{round.outcome.replace(/_/g, ' ')}</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Run these checks in your application and record what you observe. LoopTroop does not start, stop, preview, or control the application.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(isGenerating || (index?.versions.length ?? 0) > 1) && (
              <select
                aria-label="Manual QA version"
                value={version}
                onChange={(event) => {
                  const selected = Number(event.target.value)
                  setSelectedVersion(isGenerating && selected === activeVersion ? null : selected)
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                {isGenerating && activeVersion !== null && !index?.versions.some((entry) => entry.version === activeVersion) && (
                  <option value={activeVersion}>Round v{activeVersion} · generating</option>
                )}
                {index?.versions.map((entry) => <option key={entry.version} value={entry.version}>Round v{entry.version} · {entry.outcome ?? entry.status}</option>)}
              </select>
            )}
            {editable && (
              <span className={cn('text-xs', saveState === 'error' || saveState === 'conflict' ? 'text-destructive' : 'text-muted-foreground')}>
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && 'Saved'}
                {saveState === 'conflict' && 'A newer draft exists. Reload to reconcile.'}
                {saveState === 'error' && 'Autosave failed'}
                {saveState === 'idle' && dirty && 'Unsaved changes'}
              </span>
            )}
            {editable && saveState === 'conflict' && (
              <Button type="button" size="sm" variant="outline" onClick={() => void reloadConflictingDraft()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />Reload latest draft
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {round.workspaceDrift?.detected && (
            <Card className="border-amber-500/60 bg-amber-500/5">
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-500" />Application use changed project files</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Choose whether the audited changes belong in the candidate checkpoint or should be discarded. Only the listed audited files are affected.</p>
                <ul className="mt-2 max-h-28 overflow-y-auto rounded border border-border bg-background p-2 font-mono text-xs">
                  {round.workspaceDrift.files.map((file) => <li key={file.path}>{file.path}</li>)}
                </ul>
                {editable && <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void resolveDrift('include')} disabled={includeDrift.isPending || discardDrift.isPending}>{includeDrift.isPending ? <LoadingText text="Including" /> : 'Include in checkpoint'}</Button><Button size="sm" variant="outline" onClick={() => void resolveDrift('discard')} disabled={includeDrift.isPending || discardDrift.isPending}>{discardDrift.isPending ? <LoadingText text="Discarding" /> : 'Discard audited changes'}</Button></div>}
                {driftError && <p role="alert" className="mt-2 text-xs text-destructive">{driftError} Choose the same action to retry safely.</p>}
              </CardContent>
            </Card>
          )}

          {round.summary && <ManualQaRoundSummary summary={round.summary} />}

          {(round.coverage.length > 0 || coverageSourceItemTotal > 0) && (
            <Card>
              <CardHeader><CardTitle className="text-sm">PRD coverage <Badge variant="outline" className="ml-2">Advisory</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{round.coverageSummary.coveredCount} covered</span><span>·</span><span>{round.coverageSummary.partiallyCoveredCount} partial</span><span>·</span><span>{round.coverageSummary.uncoveredCount} uncovered</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(round.coverageSummary.sourceItemCounts).map(([source, count]) => <Badge key={source} variant="secondary" className="text-[10px]">{source.replace(/([A-Z])/g, ' $1').toLowerCase()}: {count}</Badge>)}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {round.coverage.map((entry) => (
                    <div key={entry.criterionRef} className="rounded border border-border px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2"><code>{entry.criterionRef}</code><Badge variant={entry.status === 'covered' ? 'default' : entry.status === 'partially_covered' ? 'secondary' : 'outline'}>{entry.status.replace('_', ' ')}</Badge></div>
                      {entry.criterion && <p className="mt-1 text-muted-foreground">{entry.criterion}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {items.map((item, indexNumber) => {
            const result = resultFor(draft, item.id)
            const errors = validation[item.id] ?? []
            const evidence = round.evidence.filter((file) => file.itemId === item.id)
            const pendingUploads = (pendingEvidenceUploads[item.id] ?? []).filter((entry) => entry.version === version)
            return (
              <Card key={item.id} className={cn(errors.length > 0 && editable && 'border-destructive/50')}>
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">{indexNumber + 1}. {item.title || item.behavior}</CardTitle>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant={item.severity === 'required' ? 'default' : 'outline'}>{item.severity === 'required' ? 'Required' : 'Optional'}</Badge>
                        {item.recheckState && item.recheckState !== 'new' && <Badge variant="outline">{item.recheckState.replace(/_/g, ' ')}</Badge>}
                        {item.prdRefs.map((reference) => <Badge key={`${reference.ref}:${reference.coverage}`} variant="outline">{reference.ref} · {reference.coverage}</Badge>)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.behavior}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {item.prerequisites.length > 0 && <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prerequisites</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{item.prerequisites.map((step) => <li key={step}>{step}</li>)}</ul></section>}
                  <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h5><ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{item.actions.map((step) => <li key={step}>{step}</li>)}</ol></section>
                  <section className="rounded-md border border-green-500/30 bg-green-500/5 p-3"><h5 className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">Expected result</h5><p className="mt-1 text-sm">{item.expectedResult}</p></section>
                  {(item.watchNotes?.length ?? 0) > 0 && <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Watch for</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{item.watchNotes?.map((note) => <li key={note}>{note}</li>)}</ul></section>}

                  <div>
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result</h5>
                    <div className="flex flex-wrap gap-2">
                      {RESULT_OPTIONS.map((option) => (
                        <button key={option.value} type="button" data-selected={result.status === option.value} disabled={!editable} onClick={() => { updateResult(item.id, { status: option.value }); if (option.value === 'improvement') setImprovementItemId(item.id) }} className={cn('rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-70', option.className)}>{option.label}</button>
                      ))}
                    </div>
                  </div>

                  {result.status === 'fail' && <div><label className="text-xs font-medium">Observed behavior <span className="text-destructive">*</span></label><textarea disabled={!editable} value={result.observation ?? ''} onChange={(event) => updateResult(item.id, { observation: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="What happened, and how did it differ from the expected result?" /><label className="mt-2 block text-xs font-medium">Merge group <span className="font-normal text-muted-foreground">(optional; matching names create one fix bead)</span></label><input disabled={!editable} value={result.mergeGroup ?? ''} onChange={(event) => updateResult(item.id, { mergeGroup: event.target.value || null })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="e.g. checkout-errors" /></div>}
                  {result.status === 'waive' && <div><label className="text-xs font-medium">Waiver reason <span className="text-destructive">*</span></label><textarea disabled={!editable} value={result.waiverReason ?? ''} onChange={(event) => updateResult(item.id, { waiverReason: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>}
                  {result.status === 'pass' && <div><label className="text-xs font-medium">Notes <span className="font-normal text-muted-foreground">(optional)</span></label><textarea disabled={!editable} value={result.note ?? ''} onChange={(event) => updateResult(item.id, { note: event.target.value })} className="mt-1 min-h-14 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>}
                  {result.status === 'improvement' && <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium">{result.improvement?.title || 'Improvement draft incomplete'}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.improvement?.description || 'Add a reviewed title and description before submission.'}</p></div>{editable && <Button size="sm" variant="outline" onClick={() => setImprovementItemId(item.id)}>Edit draft</Button>}</div></div>}

                  <section>
                    <div className="flex items-center justify-between gap-2"><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h5>{editable && <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"><FileUp className="mr-1 h-3 w-3" />Add files<input type="file" multiple className="sr-only" onChange={async (event) => {
                      const files = Array.from(event.target.files ?? [])
                      setEvidenceErrors((current) => ({ ...current, [item.id]: undefined }))
                      for (const file of files) {
                        await uploadEvidenceFile(item.id, file, newManualQaActionId('pending-evidence-upload'))
                      }
                      event.target.value = ''
                    }} /></label>}</div>
                    {evidence.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No evidence attached. Any file type is accepted up to 250 MiB per file.</p> : <div className="mt-2 grid gap-2 sm:grid-cols-2">{evidence.map((file) => { const downloadUrl = file.downloadUrl ?? manualQaEvidenceUrl(ticket.id, version, item.id, file.id); const previewUrl = manualQaEvidenceUrl(ticket.id, version, item.id, file.id, true); const canPreview = file.previewable && SAFE_RASTER_MEDIA_TYPES.has(file.mediaType); const removing = removingEvidenceIds.has(file.id); return <div key={file.id} className="overflow-hidden rounded-md border border-border bg-muted/20">{canPreview && <a href={downloadUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt={file.name} className="max-h-40 w-full object-contain bg-black/5" /></a>}<div className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{file.name}</p><p className="text-[10px] text-muted-foreground">{evidenceSize(file.size)} · {file.mediaType || 'unknown type'}</p></div><a href={downloadUrl} download={file.name} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Download ${file.name}`}><Download className="h-3.5 w-3.5" /></a>{editable && <button type="button" disabled={removing} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label={`Remove ${file.name}`} onClick={() => void removeEvidenceFile(item.id, file.id)}>{removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>}</div></div> })}</div>}
                    {(result.links?.length ?? 0) > 0 && <div className="mt-2 space-y-1">{result.links?.map((link) => <div key={link.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"><a href={link.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">{link.label || link.url}</a>{editable && <button type="button" aria-label={`Remove link ${link.label || link.url}`} onClick={() => updateResult(item.id, { links: result.links?.filter((entry) => entry.id !== link.id) })} className="rounded p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}</div>)}</div>}
                    {editable && <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={`Evidence link for ${item.id}`} value={linkDrafts[item.id]?.url ?? ''} onChange={(event) => setLinkDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? { label: '' }), url: event.target.value, error: undefined } }))} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" placeholder="https://…" /><input aria-label={`Evidence link label for ${item.id}`} value={linkDrafts[item.id]?.label ?? ''} onChange={(event) => setLinkDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? { url: '' }), label: event.target.value, error: undefined } }))} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" placeholder="Label (optional)" /><Button type="button" size="sm" variant="outline" onClick={() => { const pending = linkDrafts[item.id] ?? { url: '', label: '' }; try { const parsed = new URL(pending.url); if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(); const link = { id: newManualQaActionId('link'), url: parsed.toString(), label: pending.label.trim() || undefined }; updateResult(item.id, { links: [...(result.links ?? []), link] }); setLinkDrafts((current) => ({ ...current, [item.id]: { url: '', label: '' } })) } catch { setLinkDrafts((current) => ({ ...current, [item.id]: { ...pending, error: 'Use an HTTP or HTTPS link.' } })) } }}>Add link</Button>{linkDrafts[item.id]?.error && <p role="alert" className="text-xs text-destructive sm:col-span-3">{linkDrafts[item.id]?.error}</p>}</div>}
                    {pendingUploads.length > 0 && <div role="alert" className="mt-2 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2"><p className="text-xs text-destructive">Some uploads need attention. Confirmed uploads remain linked; Retry keeps each file&apos;s action and evidence identity while refreshing CAS guards.</p>{pendingUploads.map((pending) => <div key={pending.key} className="flex flex-wrap items-center gap-2 rounded border border-destructive/20 bg-background px-2 py-1.5 text-xs"><div className="min-w-0 flex-1"><p className="truncate font-medium">{pending.file.name}</p><p className="text-destructive">{pending.message}</p></div><Button type="button" size="sm" variant="outline" disabled={uploadEvidence.isPending} onClick={() => void uploadEvidenceFile(item.id, pending.file, pending.key)}>{uploadEvidence.isPending ? <LoadingText text="Retrying" /> : 'Retry upload'}</Button><Button type="button" size="sm" variant="ghost" disabled={uploadEvidence.isPending} onClick={() => dismissPendingEvidenceUpload(item.id, pending.key)}>Dismiss</Button></div>)}</div>}
                    {evidenceErrors[item.id] && <p role="alert" className="mt-2 text-xs text-destructive">Evidence removal could not be completed. Confirmed uploads remain linked. {evidenceErrors[item.id]}</p>}
                  </section>

                  {errors.length > 0 && editable && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{errors.map((message) => <p key={message}>{message}</p>)}</div>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {!historical && (
        <div className="shrink-0 border-t border-border bg-background p-3">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {incompleteRequired > 0 ? `${incompleteRequired} required check${incompleteRequired === 1 ? '' : 's'} incomplete` : hasFailures ? 'Failures will create Manual QA fix beads and return the ticket to Coding.' : 'Ready to submit for integration.'}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSkipOpen(true)} disabled={submissionInProgress || submit.isPending || skip.isPending || saveState === 'conflict'}><SkipForward className="mr-1 h-4 w-4" />Skip Manual QA</Button>
              <Button variant="outline" onClick={() => void persistDraft()} disabled={submissionInProgress || !dirty || saveState === 'saving'}><Save className="mr-1 h-4 w-4" />Save now</Button>
              {resumableOperationType === 'skip'
                ? <Button onClick={handleSkip} disabled={skip.isPending}>{skip.isPending ? <LoadingText text="Resuming skip" /> : <><RefreshCw className="mr-1 h-4 w-4" />Resume skip</>}</Button>
                : <Button onClick={handleSubmit} disabled={allErrors.length > 0 || submit.isPending || saveState === 'conflict' || round.workspaceDrift?.detected === true}>{submit.isPending ? <LoadingText text="Creating work" /> : submissionInProgress ? <><RefreshCw className="mr-1 h-4 w-4" />Resume submission</> : hasFailures ? <><XCircle className="mr-1 h-4 w-4" />Submit failures</> : <><CheckCircle2 className="mr-1 h-4 w-4" />Submit QA</>}</Button>}
            </div>
          </div>
          {submitError && <p role="alert" className="mx-auto mt-2 max-w-4xl text-right text-xs text-destructive">{submitError}</p>}
          {submissionInProgress && <p className="mx-auto mt-2 max-w-4xl text-right text-xs text-muted-foreground">{round.operation?.message ?? `Submission operation: ${round.operation?.status.replace(/_/g, ' ')}`}. Editing and Skip are locked until this exact operation resumes.</p>}
        </div>
      )}

      <Dialog open={improvementItem !== null} onOpenChange={(open) => { if (!open) setImprovementItemId(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Improvement backlog ticket</DialogTitle><DialogDescription>Review the title and description. One DRAFT ticket with Normal priority will be created in this project when you submit Manual QA.</DialogDescription></DialogHeader>
          {improvementItem && (() => {
            const result = resultFor(draft, improvementItem.id)
            const improvement = result.improvement ?? { title: '', description: '' }
            const preview = composeManualQaImprovementPreview(improvementItem, { ...result, improvement })
            const editableContext = improvement.contextOverride ?? buildDefaultManualQaImprovementContext(improvementItem, { ...result, improvement })
            const evidenceFiles = round.evidence.filter((file) => (result.evidenceIds ?? []).includes(file.id))
            return (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <input autoFocus value={improvement.title} onChange={(event) => updateResult(improvementItem.id, { status: 'improvement', improvement: { ...improvement, title: event.target.value } })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <textarea value={improvement.description} onChange={(event) => updateResult(improvementItem.id, { status: 'improvement', improvement: { ...improvement, description: event.target.value } })} className="mt-1 min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium">Manual QA context</label>
                  <p className="mt-1 text-xs text-muted-foreground">This context is appended to the ticket description. Edit it only when the generated details need correction; untouched context is enriched by the server during submission.</p>
                  <textarea value={editableContext} onChange={(event) => updateResult(improvementItem.id, { status: 'improvement', improvement: { ...improvement, contextOverride: event.target.value } })} className="mt-1 min-h-56 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" />
                </div>
                <div>
                  <label className="text-sm font-medium">Improvement note <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <textarea value={result.note ?? ''} onChange={(event) => updateResult(improvementItem.id, { note: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Add an observation or extra guidance for future implementation." />
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <p className="font-medium">Final description preview</p>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">{preview.description}</pre>
                  <p className={cn('mt-2', preview.omittedCharacters > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                    {preview.requestedLength.toLocaleString()} / 10,000 projected characters{preview.omittedCharacters > 0 ? ` — ${preview.omittedCharacters.toLocaleString()} lower-priority characters will be omitted and reported.` : ''}
                  </p>
                </div>
                <div className="rounded-md border border-border p-3 text-xs">
                  <p className="font-medium">Evidence and provenance preview</p>
                  <p className="mt-1 text-muted-foreground">This structured audit metadata is stored outside future implementation prompt context.</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Source ticket</dt><dd className="font-mono">{ticket.externalId}</dd>
                    <dt className="text-muted-foreground">Project</dt><dd>{ticket.projectId}</dd>
                    <dt className="text-muted-foreground">Round</dt><dd>v{version}</dd>
                    <dt className="text-muted-foreground">Checklist item</dt><dd>{improvementItem.title || improvementItem.behavior} <code className="text-[10px]">{improvementItem.id}</code></dd>
                    <dt className="text-muted-foreground">Lineage</dt><dd className="font-mono">{improvementItem.lineageId}</dd>
                    <dt className="text-muted-foreground">Result type</dt><dd>improvement</dd>
                    <dt className="text-muted-foreground">PRD refs</dt><dd>{improvementItem.prdRefs.map((reference) => reference.ref).join(', ') || 'None'}</dd>
                    <dt className="text-muted-foreground">Bead refs</dt><dd>{improvementItem.beadRefs?.join(', ') || 'None'}</dd>
                    <dt className="text-muted-foreground">Evidence plan</dt><dd>{evidenceFiles.length} uploaded file{evidenceFiles.length === 1 ? '' : 's'} and {result.links?.length ?? 0} HTTP link{(result.links?.length ?? 0) === 1 ? '' : 's'} selected for provenance</dd>
                  </dl>
                  {evidenceFiles.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                      {evidenceFiles.map((file) => <li key={file.id}>{file.name} · {evidenceSize(file.size)}</li>)}
                    </ul>
                  ) : <p className="mt-2 text-muted-foreground">No uploaded evidence selected.</p>}
                  {(result.links?.length ?? 0) > 0 && <ul className="mt-2 list-disc pl-5 text-muted-foreground">{result.links?.map((link) => <li key={link.id}>{link.label || link.url}</li>)}</ul>}
                  <p className="mt-2 text-muted-foreground">Copied and omitted evidence is finalized during submission and recorded in the created ticket&apos;s origin receipt.</p>
                </div>
                <div className="flex justify-end"><Button onClick={() => setImprovementItemId(null)} disabled={!improvement.title.trim() || !improvement.description.trim() || (improvement.contextOverride !== undefined && !improvement.contextOverride.trim())}>Done</Button></div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Skip Manual QA?</DialogTitle><DialogDescription>The current draft will be archived. Drafted improvements and failures will not create tickets or beads, and the workflow will continue to integration.</DialogDescription></DialogHeader>
          <div><label className="text-sm font-medium">Reason <span className="font-normal text-muted-foreground">(optional)</span></label><textarea value={skipReason} onChange={(event) => setSkipReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSkipOpen(false)}>Cancel</Button><Button variant="destructive" onClick={handleSkip} disabled={skip.isPending || saveState === 'conflict'}>{skip.isPending ? <LoadingText text="Skipping" /> : 'Skip and integrate'}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
