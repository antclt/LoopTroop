import type { LogEntry } from '@/context/LogContext'

export type CurrentActivityDiagnostic =
  | 'provider_retry_timeout'
  | 'provider_timeout_preserved'
  | 'iteration_timeout'
  | 'model_no_activity_timeout'
  | 'near_timeout'
  | 'empty_model_output'
  | 'workflow_timeout'

export type CurrentActivityKind =
  | 'waiting_first_model_activity'
  | 'provider_retrying'
  | CurrentActivityDiagnostic

export interface CurrentActivity {
  kind: CurrentActivityKind
  label: string
  diagnostic?: CurrentActivityDiagnostic
  active: boolean
  severity: 'info' | 'warning' | 'error'
  elapsedMs?: number
  modelId?: string
  sessionId?: string
  beadId?: string
}

interface IndexedEntry {
  entry: LogEntry
  index: number
  timeMs: number
}

interface DiagnosticCandidate {
  kind: CurrentActivityDiagnostic
  indexedEntry: IndexedEntry
}

const FIRST_ACTIVITY_KINDS = new Set([
  'reasoning',
  'text',
  'model_output',
  'tool',
  'step',
  'question',
  'todo',
  'part_summary',
  'file_edit',
  'file-edited',
  'file_edited',
  'done',
])

const TRUSTED_DIAGNOSTIC_SOURCES = new Set(['error', 'system', 'opencode', 'workflow'])
const TRUSTED_DIAGNOSTIC_KINDS = new Set(['error', 'milestone', 'session'])
const NEAR_TIMEOUT_MIN_MS = 30_000
const NEAR_TIMEOUT_MAX_MS = 120_000
const NEAR_TIMEOUT_RATIO = 0.1

function parseTimeMs(timestamp?: string): number {
  if (!timestamp) return Number.NaN
  const timeMs = Date.parse(timestamp)
  return Number.isFinite(timeMs) ? timeMs : Number.NaN
}

function compareIndexedEntries(a: IndexedEntry, b: IndexedEntry): number {
  const aHasTime = Number.isFinite(a.timeMs)
  const bHasTime = Number.isFinite(b.timeMs)
  if (aHasTime && bHasTime && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  if (aHasTime !== bHasTime) return aHasTime ? -1 : 1
  return a.index - b.index
}

function sortEntries(entries: LogEntry[]): IndexedEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, timeMs: parseTimeMs(entry.timestamp) }))
    .sort(compareIndexedEntries)
}

function getModelId(entry: LogEntry): string | undefined {
  if (entry.modelId) return entry.modelId
  if (entry.source.startsWith('model:')) return entry.source.slice('model:'.length)
  return undefined
}

function isPromptEntry(entry: LogEntry): boolean {
  return entry.kind === 'prompt' || entry.line.includes('[PROMPT]')
}

function isFirstActivityEntry(entry: LogEntry): boolean {
  const normalizedLine = entry.line.toLowerCase()
  if (normalizedLine.includes('first ai activity observed')) return true
  if (isPromptEntry(entry)) return false
  if (FIRST_ACTIVITY_KINDS.has(entry.kind)) return true
  return entry.audience === 'ai'
    && entry.kind !== 'session'
    && entry.kind !== 'error'
    && entry.kind !== 'prompt'
}

function isProviderRetryEntry(entry: LogEntry): boolean {
  return /\bsession retry\b/i.test(entry.line) || /\bsession status:\s*retry\b/i.test(entry.line)
}

function isTrustedDiagnosticEntry(entry: LogEntry): boolean {
  return entry.audience !== 'ai'
    && TRUSTED_DIAGNOSTIC_SOURCES.has(entry.source)
    && TRUSTED_DIAGNOSTIC_KINDS.has(entry.kind)
}

function isProviderRetryTimeoutEntry(entry: LogEntry): boolean {
  return isTrustedDiagnosticEntry(entry)
    && /\bopencode retry (?:budget exhausted|grace window expired)\b/i.test(entry.line)
}

function isProviderTimeoutPreservedEntry(entry: LogEntry): boolean {
  return isTrustedDiagnosticEntry(entry)
    && /\bopencode\/provider timeout for session \S+;\s*preserving session for continue\b/i.test(entry.line)
}

function isEmptyModelOutputEntry(entry: LogEntry): boolean {
  return isTrustedDiagnosticEntry(entry) && /\bresponseChars=0\b/i.test(entry.line)
}

function isPromptResultEntry(entry: LogEntry): boolean {
  return isTrustedDiagnosticEntry(entry)
    && /\bOpenCode\b.+\bsession=\S+,\s*messages=\d+,\s*responseChars=\d+\b/i.test(entry.line)
}

function isPromptCompletionEntry(entry: LogEntry): boolean {
  if (entry.kind === 'session' && /\bsession status:\s*idle\b/i.test(entry.line)) return true
  if (entry.kind === 'milestone' && /\bAI session completed\b/i.test(entry.line)) return true
  return isPromptResultEntry(entry)
}

function isIterationTimeoutEntry(entry: LogEntry): boolean {
  return isTrustedDiagnosticEntry(entry)
    && /\biteration timeout for bead \S+ attempt \d+;\s*resetting for attempt \d+(?: of \d+)?\b/i.test(entry.line)
}

function isTrustedPromptTimeoutEntry(entry: LogEntry): boolean {
  if (!isTrustedDiagnosticEntry(entry)) return false
  if (isProviderRetryTimeoutEntry(entry)) return false
  if (isProviderTimeoutPreservedEntry(entry)) return false
  if (isIterationTimeoutEntry(entry)) return false
  return /\bopencode prompt timed out after \d+ms\b/i.test(entry.line)
    || /\bworkflow(?: deadline)? timeout(?:\b| after\b)/i.test(entry.line)
    || /\bdeadline exceeded\b/i.test(entry.line)
}

function parseDeadlineMs(deadlineAt?: string): number {
  if (!deadlineAt) return Number.NaN
  const deadlineMs = Date.parse(deadlineAt)
  return Number.isFinite(deadlineMs) ? deadlineMs : Number.NaN
}

function getNearTimeoutWindowMs(timeoutMs: number): number {
  return Math.min(NEAR_TIMEOUT_MAX_MS, Math.max(NEAR_TIMEOUT_MIN_MS, timeoutMs * NEAR_TIMEOUT_RATIO))
}

function isNearTimeoutPrompt(prompt: LogEntry, nowMs: number): boolean {
  if (typeof prompt.timeoutMs !== 'number' || !Number.isFinite(prompt.timeoutMs) || prompt.timeoutMs <= 0) {
    return false
  }
  const deadlineMs = parseDeadlineMs(prompt.deadlineAt)
  if (!Number.isFinite(deadlineMs)) return false
  return nowMs >= deadlineMs - getNearTimeoutWindowMs(prompt.timeoutMs)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entryMentionsSession(entry: LogEntry, sessionId: string): boolean {
  return new RegExp(`\\bsession(?:\\s*[=:]\\s*|\\s+)${escapeRegExp(sessionId)}\\b`, 'i').test(entry.line)
    || entry.line.includes(`(${sessionId})`)
}

function entryMentionsBead(entry: LogEntry, beadId: string): boolean {
  return new RegExp(`\\bbead(?:\\s*[=:]\\s*|\\s+)${escapeRegExp(beadId)}\\b`, 'i').test(entry.line)
    || entry.line.includes(`(${beadId})`)
}

function entryRelatesToPrompt(entry: LogEntry, prompt: LogEntry): boolean {
  if (!prompt.sessionId) return true
  if (entry.sessionId) return entry.sessionId === prompt.sessionId
  if (entryMentionsSession(entry, prompt.sessionId)) return true
  if (prompt.beadId) {
    if (entry.beadId) return entry.beadId === prompt.beadId
    if (entryMentionsBead(entry, prompt.beadId)) return true
  }
  return entry.audience === 'all' || entry.source === 'system' || entry.source === 'error'
}

function buildDiagnosticActivity(
  kind: CurrentActivityDiagnostic,
  prompt: LogEntry,
  elapsedUntilMs: number,
): CurrentActivity {
  const elapsedMs = Number.isFinite(parseTimeMs(prompt.timestamp))
    ? Math.max(0, elapsedUntilMs - parseTimeMs(prompt.timestamp))
    : undefined

  switch (kind) {
    case 'provider_retry_timeout':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'error',
        label: 'Provider retry timeout',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'provider_timeout_preserved':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'warning',
        label: 'Provider timeout preserved for Continue',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'iteration_timeout':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'error',
        label: 'Iteration timeout; retrying bead',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'model_no_activity_timeout':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'error',
        label: 'Timed out before first model activity',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'near_timeout':
      return {
        kind,
        diagnostic: kind,
        active: true,
        severity: 'warning',
        label: 'Approaching timeout',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'empty_model_output':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'warning',
        label: 'Model returned no visible output',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
    case 'workflow_timeout':
      return {
        kind,
        diagnostic: kind,
        active: false,
        severity: 'error',
        label: 'Workflow timeout',
        elapsedMs,
        modelId: getModelId(prompt),
        sessionId: prompt.sessionId,
        beadId: prompt.beadId,
      }
  }
}

function pickLatestDiagnostic(candidates: DiagnosticCandidate[]): DiagnosticCandidate | null {
  if (candidates.length === 0) return null
  return candidates.reduce((latest, candidate) => (
    compareIndexedEntries(candidate.indexedEntry, latest.indexedEntry) > 0 ? candidate : latest
  ))
}

export function formatElapsedDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes === 0) return `${seconds}s`

  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours === 0) return `${totalMinutes}m ${seconds}s`

  return `${hours}h ${minutes}m`
}

export function deriveCurrentActivity(entries: LogEntry[], nowMs = Date.now()): CurrentActivity | null {
  const orderedEntries = sortEntries(entries)
  const latestPromptIndex = orderedEntries.findLastIndex(({ entry }) => isPromptEntry(entry))
  if (latestPromptIndex < 0) return null

  const prompt = orderedEntries[latestPromptIndex]!.entry
  const promptTimeMs = orderedEntries[latestPromptIndex]!.timeMs
  const entriesAfterPrompt = orderedEntries
    .slice(latestPromptIndex + 1)
    .filter(({ entry }) => entryRelatesToPrompt(entry, prompt))

  const firstActivityIndex = entriesAfterPrompt.findIndex(({ entry }) => isFirstActivityEntry(entry))
  const firstActivityEntry = firstActivityIndex >= 0 ? entriesAfterPrompt[firstActivityIndex]! : null
  const hasFirstActivity = firstActivityEntry !== null
  const promptCompletionEntry = entriesAfterPrompt.findLast(({ entry }) => isPromptCompletionEntry(entry))
  const diagnosticCandidates: DiagnosticCandidate[] = []

  for (const indexedEntry of entriesAfterPrompt) {
    const { entry } = indexedEntry
    if (isProviderRetryTimeoutEntry(entry)) {
      diagnosticCandidates.push({ kind: 'provider_retry_timeout', indexedEntry })
    } else if (isProviderTimeoutPreservedEntry(entry)) {
      diagnosticCandidates.push({ kind: 'provider_timeout_preserved', indexedEntry })
    } else if (isEmptyModelOutputEntry(entry)) {
      diagnosticCandidates.push({ kind: 'empty_model_output', indexedEntry })
    } else if (isIterationTimeoutEntry(entry)) {
      diagnosticCandidates.push({ kind: 'iteration_timeout', indexedEntry })
    } else if (isTrustedPromptTimeoutEntry(entry)) {
      const activityStartedBeforeTimeout = firstActivityEntry
        ? compareIndexedEntries(firstActivityEntry, indexedEntry) < 0
        : false
      diagnosticCandidates.push({
        kind: activityStartedBeforeTimeout ? 'workflow_timeout' : 'model_no_activity_timeout',
        indexedEntry,
      })
    }
  }

  const latestDiagnostic = pickLatestDiagnostic(diagnosticCandidates)
  if (latestDiagnostic) {
    const elapsedUntilMs = Number.isFinite(latestDiagnostic.indexedEntry.timeMs)
      ? latestDiagnostic.indexedEntry.timeMs
      : nowMs
    return buildDiagnosticActivity(latestDiagnostic.kind, prompt, elapsedUntilMs)
  }

  if (promptCompletionEntry || hasFirstActivity) return null

  if (isNearTimeoutPrompt(prompt, nowMs)) {
    return buildDiagnosticActivity('near_timeout', prompt, nowMs)
  }

  const elapsedMs = Number.isFinite(promptTimeMs) ? Math.max(0, nowMs - promptTimeMs) : undefined
  const latestRetry = entriesAfterPrompt.findLast(({ entry }) => isProviderRetryEntry(entry))

  return {
    kind: latestRetry ? 'provider_retrying' : 'waiting_first_model_activity',
    active: true,
    severity: latestRetry ? 'warning' : 'info',
    label: latestRetry ? 'Provider retrying before first model activity' : 'Waiting for first model activity',
    elapsedMs,
    modelId: getModelId(prompt),
    sessionId: prompt.sessionId,
    beadId: prompt.beadId,
  }
}
