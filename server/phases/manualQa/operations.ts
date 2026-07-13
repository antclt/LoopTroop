import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { and, eq } from 'drizzle-orm'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { writeJsonl, readJsonl } from '../../io/jsonl'
import {
  archiveActivePhaseAttempts,
  createFreshPhaseAttempts,
  createTicket,
  getLatestPhaseArtifact,
  getTicketContext,
  getTicketByRef,
  getTicketPaths,
  insertPhaseArtifact,
  listTickets,
  patchTicket,
  resolvePhaseAttempt,
} from '../../storage/tickets'
import { manualQaOperations } from '../../db/schema'
import type { TicketEvent } from '../../machines/types'
import type { Bead, QaOrigin, QaOriginEvidenceRef, QaOriginSourceItem } from '../beads/types'
import { captureFinalTestDirtyFiles } from '../finalTest/fileEffectsAudit'
import { fetchProviderCatalog, flattenCatalogModels } from '../../opencode/providerCatalog'
import {
  MANUAL_QA_SCHEMA_VERSION,
  ManualQaDraftSchema,
  type ManualQaChecklist,
  type ManualQaDraft,
  type ManualQaEvidenceRef,
  type ManualQaImprovementDraft,
  type ManualQaItemResult,
  type ManualQaResults,
  type ManualQaSummary,
} from './types'
import {
  getManualQaChecklistHash,
  getManualQaStoragePaths,
  getManualQaEvidenceRelativePath,
  persistManualQaResults,
  persistManualQaSummary,
  readManualQaChecklist,
  readManualQaEvidenceIndex,
  readManualQaSummary,
  resolveManualQaEvidence,
  resolveManualQaTicketDir,
  snapshotManualQaDraft,
} from './storage'

export interface ManualQaMutationGuard {
  actionId: string
  expectedChecklistHash: string
  expectedDraftRevision: number
}

export interface ManualQaWorkspaceDrift {
  drifted: boolean
  headChanged: boolean
  baselineHead: string
  currentHead: string
  files: ReturnType<typeof captureFinalTestDirtyFiles>
}

interface ManualQaOperationJournal {
  schemaVersion: 1
  actionId: string
  ticketId: string
  version: number
  checklistHash: string
  draftRevision: number
  state: 'staged' | 'creating_improvements' | 'creating_beads' | 'complete'
  improvementTicketIds: string[]
  fixBeadIds: string[]
  createdAt: string
  updatedAt: string
}

interface ImprovementOrigin {
  schemaVersion: 1
  originId: string
  actionId: string
  sourceTicketId: string
  sourceTicketExternalId: string
  sourceVersion: number
  sourceItemId: string
  sourceItemTitle: string
  evidenceRefs: QaOriginEvidenceRef[]
  omittedEvidence: Array<{ id: string; reason: string }>
  titleSha256: string
  descriptionSha256: string
  omittedFields: string[]
  createdAt: string
}

function runGitHead(worktreePath: string): string {
  const result = spawnSync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0 || result.error) throw new Error('Unable to read Manual QA workspace HEAD.')
  return (result.stdout ?? '').trim()
}

function runGitText(worktreePath: string, args: string[]): string {
  const result = spawnSync('git', ['-C', worktreePath, ...args], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0 || result.error) throw new Error(`Unable to audit Manual QA workspace: git ${args[0] ?? ''} failed.`)
  return (result.stdout ?? '').trim()
}

export function detectManualQaWorkspaceDrift(ticketId: string, version: number): ManualQaWorkspaceDrift {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket storage was not found: ${ticketId}`)
  const baselinePath = getManualQaStoragePaths(paths.ticketDir, version).baselinePath
  if (!existsSync(baselinePath)) throw new Error('Manual QA workspace baseline is missing.')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { head: string; trackedSignatures?: Record<string, string> }
  const currentHead = runGitHead(paths.worktreePath)
  const dirtyFiles = captureFinalTestDirtyFiles(paths.worktreePath)
  const currentSignatures: Record<string, string> = {}
  for (const entry of runGitText(paths.worktreePath, ['ls-files', '-s', '-z']).split('\0')) {
    const match = entry.match(/^\d+ ([0-9a-f]+) \d+\t(.+)$/)
    if (match?.[1] && match[2]) currentSignatures[match[2]] = match[1]
  }
  const signaturePaths = new Set([
    ...Object.keys(baseline.trackedSignatures ?? {}),
    ...Object.keys(currentSignatures),
  ])
  const committedPaths = new Set<string>()
  for (const path of signaturePaths) {
    if ((baseline.trackedSignatures ?? {})[path] !== currentSignatures[path]) committedPaths.add(path)
  }
  if (baseline.head !== currentHead) {
    for (const line of runGitText(paths.worktreePath, ['diff', '--name-status', baseline.head, currentHead, '--', '.', ':(top,exclude).ticket', ':(top,exclude).looptroop']).split('\n')) {
      const fields = line.split('\t')
      for (const path of fields.slice(1)) if (path) committedPaths.add(path)
    }
  }
  const dirtyPaths = new Set(dirtyFiles.map((entry) => entry.path))
  const files = [
    ...dirtyFiles,
    ...[...committedPaths].filter((path) => !dirtyPaths.has(path)).map((path) => ({
      path,
      indexStatus: 'C',
      worktreeStatus: ' ',
      rawStatus: 'C ',
      untracked: !(path in currentSignatures),
      contentSignature: currentSignatures[path] ?? null,
    })),
  ]
  return {
    drifted: baseline.head !== currentHead || files.length > 0,
    headChanged: baseline.head !== currentHead,
    baselineHead: baseline.head,
    currentHead,
    files,
  }
}

function assertMutationGuard(ticketId: string, ticketDir: string, version: number, draft: ManualQaDraft, guard: ManualQaMutationGuard): void {
  if (!guard.actionId.trim()) throw new Error('Manual QA mutation requires an action ID.')
  const checklistHash = getManualQaChecklistHash(ticketDir, version)
  if (!checklistHash || checklistHash !== guard.expectedChecklistHash || checklistHash !== draft.checklistHash) {
    throw new Error('Manual QA checklist changed; reload the active version before submitting.')
  }
  if (draft.draftRevision !== guard.expectedDraftRevision) {
    throw new Error('Manual QA draft revision changed; reload before submitting.')
  }
  const uiState = getLatestPhaseArtifact(ticketId, `ui_state:manual_qa_draft:v${version}`, 'UI_STATE')
  let serverRevision = 0
  if (uiState) {
    try {
      const parsed = JSON.parse(uiState.content) as { revision?: unknown }
      serverRevision = typeof parsed.revision === 'number' && Number.isInteger(parsed.revision) ? parsed.revision : 0
    } catch {
      throw new Error('Stored Manual QA draft state is invalid.')
    }
  }
  if (serverRevision !== guard.expectedDraftRevision) {
    throw new Error('Manual QA draft revision conflict; reload the server-owned draft before submitting.')
  }
}

function validateSubmission(checklist: ManualQaChecklist, draft: ManualQaDraft): void {
  const items = new Map(checklist.items.map((item) => [item.id, item]))
  const results = new Map<string, ManualQaItemResult>()
  for (const result of draft.results) {
    if (!items.has(result.itemId)) throw new Error(`Result references unknown checklist item: ${result.itemId}`)
    if (results.has(result.itemId)) throw new Error(`Duplicate result for checklist item: ${result.itemId}`)
    results.set(result.itemId, result)
  }
  for (const item of checklist.items) {
    const outcome = results.get(item.id)?.outcome ?? 'pending'
    if (item.required && !['pass', 'fail', 'waive'].includes(outcome)) {
      throw new Error(`Required checklist item ${item.id} must be passed, failed, or waived.`)
    }
  }

  const improvementById = new Map(draft.improvements.map((improvement) => [improvement.id, improvement]))
  for (const result of draft.results) {
    if (result.outcome !== 'improvement') continue
    const improvement = result.improvementDraftId ? improvementById.get(result.improvementDraftId) : null
    if (!improvement || improvement.itemId !== result.itemId) {
      throw new Error(`Improvement result ${result.itemId} does not have a matching reviewed draft.`)
    }
  }

  const knownEvidence = new Set(draft.evidence.map((entry) => entry.id))
  const referencedEvidence = [
    ...draft.results.flatMap((result) => result.evidenceIds),
    ...draft.improvements.flatMap((improvement) => improvement.evidenceIds),
  ]
  const unknown = referencedEvidence.find((id) => !knownEvidence.has(id))
  if (unknown) throw new Error(`Manual QA draft references unknown evidence: ${unknown}`)
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

function writeJournal(path: string, journal: ManualQaOperationJournal): void {
  safeAtomicWrite(path, JSON.stringify(journal, null, 2))
}

function persistManualQaDatabaseOperation(ticketId: string, journal: ManualQaOperationJournal): void {
  const context = getTicketContext(ticketId)
  if (!context) throw new Error(`Ticket was not found for Manual QA operation: ${ticketId}`)
  context.projectDb.insert(manualQaOperations).values({
    ticketId: context.localTicketId,
    actionId: journal.actionId,
    version: journal.version,
    checklistHash: journal.checklistHash,
    draftRevision: journal.draftRevision,
    state: journal.state,
    payload: JSON.stringify(journal),
    updatedAt: journal.updatedAt,
  }).onConflictDoNothing().run()
  const existing = context.projectDb.select().from(manualQaOperations).where(and(
    eq(manualQaOperations.ticketId, context.localTicketId),
    eq(manualQaOperations.actionId, journal.actionId),
  )).get()
  if (!existing) throw new Error('Failed to persist Manual QA database idempotency record.')
  if (
    existing.version !== journal.version
    || existing.checklistHash !== journal.checklistHash
    || existing.draftRevision !== journal.draftRevision
  ) throw new Error('Manual QA action ID was already used with different database input.')
  context.projectDb.update(manualQaOperations).set({
    state: journal.state,
    payload: JSON.stringify(journal),
    updatedAt: journal.updatedAt,
  }).where(eq(manualQaOperations.id, existing.id)).run()
}

export function reserveManualQaSubmissionOperation(input: {
  path: string
  actionId: string
  ticketId: string
  version: number
  checklistHash: string
  draftRevision: number
}): ManualQaOperationJournal {
  if (existsSync(input.path)) {
    const existing = JSON.parse(readFileSync(input.path, 'utf8')) as ManualQaOperationJournal
    if (
      existing.actionId !== input.actionId
      || existing.ticketId !== input.ticketId
      || existing.version !== input.version
      || existing.checklistHash !== input.checklistHash
      || existing.draftRevision !== input.draftRevision
    ) throw new Error('Manual QA submission action ID was already used with different input.')
    return existing
  }
  const now = new Date().toISOString()
  const journal: ManualQaOperationJournal = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    actionId: input.actionId,
    ticketId: input.ticketId,
    version: input.version,
    checklistHash: input.checklistHash,
    draftRevision: input.draftRevision,
    state: 'staged',
    improvementTicketIds: [],
    fixBeadIds: [],
    createdAt: now,
    updatedAt: now,
  }
  writeJournal(input.path, journal)
  return journal
}

function evidenceForIds(evidence: ManualQaEvidenceRef[], ids: string[]): ManualQaEvidenceRef[] {
  const wanted = new Set(ids)
  return evidence.filter((entry) => wanted.has(entry.id))
}

function buildQaContextSection(input: {
  sourceExternalId: string
  version: number
  itemId: string
  behavior: string
  source?: string
  expectedResult: string
  actions?: string[]
  userNote?: string
  improvementTitle?: string
  evidence: ManualQaEvidenceRef[]
  links?: Array<{ url: string; label?: string }>
  prdRefs?: string[]
  beadRefs?: string[]
}): string {
  return [
    '',
    '## Manual QA Context',
    'This ticket was created from a reviewed Manual QA improvement. Implement it as independent backlog work; the source evidence and checklist context are provenance, not instructions to control or start the user application.',
    `Source ticket: ${input.sourceExternalId}`,
    `QA round: v${input.version}`,
    `Source item: ${input.itemId}`,
    ...(input.userNote?.trim() ? ['', '### User Note', input.userNote.trim()] : []),
    '',
    '### Checklist Item',
    `Behavior: ${input.behavior}`,
    ...(input.source ? [`Source: ${input.source}`] : []),
    `Expected result: ${input.expectedResult}`,
    ...(input.actions?.length ? ['Actions:', ...input.actions.map((action) => `- ${action}`)] : []),
    ...(input.improvementTitle ? ['', '### Improvement Request', input.improvementTitle] : []),
    ...(input.evidence.length || input.links?.length ? [
      '',
      '### Evidence',
      ...input.evidence.map((entry) => `- ${entry.originalName} (${entry.mediaType}, ${entry.size} bytes, sha256 ${entry.sha256})`),
      ...(input.links ?? []).map((link) => `- ${link.label ? `${link.label}: ` : ''}${link.url}`),
    ] : []),
    ...(input.prdRefs?.length ? ['', `PRD references: ${input.prdRefs.join(', ')}`] : []),
    ...(input.beadRefs?.length ? [`Bead references: ${input.beadRefs.join(', ')}`] : []),
  ].join('\n')
}

export function buildImprovementDescription(input: {
  description: string
  sourceExternalId: string
  version: number
  itemId: string
  behavior: string
  source?: string
  expectedResult: string
  actions?: string[]
  userNote?: string
  improvementTitle?: string
  evidence: ManualQaEvidenceRef[]
  links?: Array<{ url: string; label?: string }>
  prdRefs?: string[]
  beadRefs?: string[]
}): { description: string; omittedCharacters: number; omittedFields: string[] } {
  const omittedFields: string[] = []
  const baseContext = buildQaContextSection({
    ...input,
    actions: [],
    evidence: [],
    links: [],
    prdRefs: [],
    beadRefs: [],
  })
  // Retention priority: edited description, improvement/user note and request,
  // actions/observed behavior, evidence, then compact PRD/bead provenance.
  const descriptionBudget = Math.max(0, 10_000 - baseContext.length - 2)
  const retained = input.description.slice(0, descriptionBudget)
  if (retained.length < input.description.length) omittedFields.push('userEditedDescription')
  let output = `${retained}${baseContext}`
  const append = (label: string, content: string) => {
    if (!content.trim()) return
    const fragment = `\n${content}`
    const available = 10_000 - output.length
    if (available <= 1) {
      omittedFields.push(label)
      return
    }
    output += fragment.slice(0, available)
    if (fragment.length > available) omittedFields.push(label)
  }
  append('actions', input.actions?.length ? `Actions:\n${input.actions.map((action) => `- ${action}`).join('\n')}` : '')
  append('evidence', [
    ...input.evidence.map((entry) => `- ${entry.originalName} (${entry.mediaType}, ${entry.size} bytes, sha256 ${entry.sha256})`),
    ...(input.links ?? []).map((link) => `- ${link.label ? `${link.label}: ` : ''}${link.url}`),
  ].join('\n'))
  append('prdRefs', input.prdRefs?.length ? `PRD references: ${input.prdRefs.join(', ')}` : '')
  append('beadRefs', input.beadRefs?.length ? `Bead references: ${input.beadRefs.join(', ')}` : '')
  return {
    description: output.slice(0, 10_000),
    omittedCharacters: Math.max(0, input.description.length - retained.length),
    omittedFields: [...new Set(omittedFields)],
  }
}

function copyImprovementEvidence(input: {
  sourceTicketDir: string
  destinationTicketDir: string
  version: number
  itemId: string
  evidence: ManualQaEvidenceRef[]
}): { copied: QaOriginEvidenceRef[]; omitted: Array<{ id: string; reason: string }> } {
  const destinationDir = resolve(input.destinationTicketDir, 'origin', 'manual-qa', 'evidence')
  mkdirSync(destinationDir, { recursive: true })
  const copied: QaOriginEvidenceRef[] = []
  const omitted: Array<{ id: string; reason: string }> = []
  for (const evidence of input.evidence) {
    try {
      const source = resolveManualQaEvidence({
        ticketDir: input.sourceTicketDir,
        version: input.version,
        itemId: input.itemId,
        evidenceId: evidence.id,
      })
      if (lstatSync(source.path).isSymbolicLink()) throw new Error('symlink evidence is not allowed')
      const destinationName = `${evidence.id}-${basename(evidence.storedName)}`
      const destination = resolve(destinationDir, destinationName)
      cpSync(source.path, destination, { errorOnExist: false, force: true })
      const rawHash = createHash('sha256').update(readFileSync(destination)).digest('hex')
      if (rawHash !== evidence.sha256) throw new Error('hash mismatch')
      copied.push({
        id: evidence.id,
        originalName: evidence.originalName,
        mediaType: evidence.mediaType,
        size: evidence.size,
        sha256: evidence.sha256,
        relativePath: `origin/manual-qa/evidence/${destinationName}`,
      })
    } catch (error) {
      omitted.push({ id: evidence.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { copied, omitted }
}

function findExistingImprovement(projectId: number, originId: string): ReturnType<typeof listTickets>[number] | null {
  return listTickets(projectId).find((ticket) => ticket.description?.includes(`Manual QA origin: ${originId}`)) ?? null
}

function createImprovementTicket(input: {
  sourceTicketId: string
  sourceExternalId: string
  sourceTicketDir: string
  projectId: number
  version: number
  actionId: string
  draft: ManualQaImprovementDraft
  item: ManualQaChecklist['items'][number]
  result: ManualQaItemResult
  evidence: ManualQaEvidenceRef[]
}): string {
  const originId = `manual-qa:${input.sourceExternalId}:v${input.version}:${input.draft.id}`
  const existing = findExistingImprovement(input.projectId, originId)
  if (existing) return existing.id
  const built = buildImprovementDescription({
    description: input.draft.description,
    sourceExternalId: input.sourceExternalId,
    version: input.version,
    itemId: input.item.id,
    behavior: input.item.behavior,
    source: input.item.source,
    expectedResult: input.item.expectedResult,
    actions: input.item.actions,
    userNote: input.result.note,
    improvementTitle: input.draft.title,
    evidence: input.evidence,
    links: input.result.links,
    prdRefs: input.item.prdRefs.map((entry) => `${entry.ref} (${entry.coverage})`),
    beadRefs: input.item.beadRefs,
  })
  const contextMarker = `\nManual QA origin: ${originId}`
  const description = `${built.description.slice(0, 10_000 - contextMarker.length)}${contextMarker}`
  const ticket = createTicket({
    projectId: input.projectId,
    title: input.draft.title,
    description,
    priority: 3,
    manualQaOverride: null,
  })
  const destinationPaths = getTicketPaths(ticket.id)
  if (!destinationPaths) throw new Error(`Improvement ticket storage was not created: ${ticket.id}`)
  const copied = copyImprovementEvidence({
    sourceTicketDir: input.sourceTicketDir,
    destinationTicketDir: destinationPaths.ticketDir,
    version: input.version,
    itemId: input.item.id,
    evidence: input.evidence,
  })
  const origin: ImprovementOrigin = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    originId,
    actionId: input.actionId,
    sourceTicketId: input.sourceTicketId,
    sourceTicketExternalId: input.sourceExternalId,
    sourceVersion: input.version,
    sourceItemId: input.item.id,
    sourceItemTitle: input.item.behavior,
    evidenceRefs: copied.copied,
    omittedEvidence: copied.omitted,
    titleSha256: contentSha256Text(input.draft.title),
    descriptionSha256: contentSha256Text(description),
    omittedFields: built.omittedFields,
    createdAt: new Date().toISOString(),
  }
  safeAtomicWrite(resolve(destinationPaths.ticketDir, 'meta', 'manual-qa-origin.json'), JSON.stringify(origin, null, 2))
  safeAtomicWrite(resolve(destinationPaths.ticketDir, 'origin', 'manual-qa', 'source-receipt.json'), JSON.stringify(origin, null, 2))
  return ticket.id
}

function contentSha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function buildQaFixBeads(input: {
  existing: Bead[]
  checklist: ManualQaChecklist
  results: ManualQaItemResult[]
  evidence: ManualQaEvidenceRef[]
  ticketId: string
  externalId: string
  version: number
  actionId: string
  imageDelivery: 'attached' | 'references_only'
}): Bead[] {
  const failed = input.results.filter((result) => result.outcome === 'fail')
  const groups = new Map<string, ManualQaItemResult[]>()
  for (const result of failed) {
    const key = result.mergeGroupId ?? `item:${result.itemId}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  const itemById = new Map(input.checklist.items.map((item) => [item.id, item]))
  const beadById = new Map(input.existing.map((bead) => [bead.id, bead]))
  const maxPriority = input.existing.reduce((max, bead) => Math.max(max, bead.priority), 0)
  const now = new Date().toISOString()

  return [...groups.entries()].map(([groupId, results], index): Bead => {
    const sourceItems: QaOriginSourceItem[] = results.map((result) => {
      const item = itemById.get(result.itemId)!
      return {
        itemId: item.id,
        lineageId: item.lineageId,
        behavior: item.behavior,
        observation: result.observation,
        expectedResult: item.expectedResult,
        evidence: evidenceForIds(input.evidence, result.evidenceIds).map((entry) => ({
          id: entry.id,
          originalName: entry.originalName,
          mediaType: entry.mediaType,
          size: entry.size,
          sha256: entry.sha256,
          relativePath: getManualQaEvidenceRelativePath(input.version, entry),
        })),
        links: result.links,
      }
    })
    const origin: QaOrigin = {
      schemaVersion: MANUAL_QA_SCHEMA_VERSION,
      actionId: input.actionId,
      sourceTicketId: input.ticketId,
      sourceTicketExternalId: input.externalId,
      version: input.version,
      sourceItems,
      imageDelivery: input.imageDelivery,
    }
    const referencedBeads = sourceItems.flatMap((source) => itemById.get(source.itemId)?.beadRefs ?? [])
    const targetFiles = [...new Set(referencedBeads.flatMap((id) => beadById.get(id)?.targetFiles ?? []))]
    const id = deterministicId(`qa-v${input.version}`, `${input.ticketId}:${input.version}:${groupId}`)
    return {
      id,
      title: `Manual QA fix: ${sourceItems.map((item) => item.behavior).join('; ').slice(0, 240)}`,
      prdRefs: [...new Set(results.flatMap((result) => itemById.get(result.itemId)?.prdRefs.map((ref) => ref.ref) ?? []))],
      description: sourceItems.map((item) => `${item.behavior}\nObserved: ${item.observation}\nExpected: ${item.expectedResult}`).join('\n\n'),
      contextGuidance: {
        patterns: ['Use the structured Manual QA origin and preserve evidence references.'],
        anti_patterns: ['Do not conflate retry notes with Manual QA observations.'],
      },
      acceptanceCriteria: sourceItems.map((item) => `${item.itemId}: ${item.expectedResult}`),
      tests: sourceItems.map((item) => `Add or update an automated regression check for: ${item.behavior}`),
      testCommands: [],
      priority: maxPriority + index + 1,
      status: 'pending',
      issueType: 'qa-fix',
      externalRef: input.externalId,
      labels: ['manual-looptroop-qa'],
      dependencies: { blocked_by: [], blocks: [] },
      targetFiles,
      notes: '',
      iteration: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: '',
      startedAt: '',
      beadStartCommit: null,
      qaOrigin: origin,
    }
  })
}

async function resolveQaImageDelivery(modelId: string | null | undefined, evidence: ManualQaEvidenceRef[]): Promise<'attached' | 'references_only'> {
  if (!modelId || !evidence.some((entry) => entry.mediaType.toLowerCase().startsWith('image/'))) return 'references_only'
  try {
    const catalog = await fetchProviderCatalog()
    return flattenCatalogModels(catalog, 'all').some((model) => model.fullId === modelId && model.canSeeImages)
      ? 'attached'
      : 'references_only'
  } catch {
    return 'references_only'
  }
}

function persistSummaryArtifact(ticketId: string, summary: ManualQaSummary): void {
  persistManualQaPhaseArtifact(ticketId, 'manual_qa_summary', summary, `${summary.version}:${summary.outcome}`)
}

function persistManualQaPhaseArtifact(ticketId: string, artifactType: string, value: unknown, idempotencyKey: string): void {
  const existing = getLatestPhaseArtifact(ticketId, artifactType, 'WAITING_MANUAL_QA')
  if (existing?.content.includes(`"idempotencyKey":"${idempotencyKey}"`)) return
  insertPhaseArtifact(ticketId, {
    phase: 'WAITING_MANUAL_QA',
    phaseAttempt: resolvePhaseAttempt(ticketId, 'WAITING_MANUAL_QA'),
    artifactType,
    content: JSON.stringify({ idempotencyKey, value }),
  })
}

export async function submitManualQa(input: {
  ticketId: string
  version: number
  draft: ManualQaDraft
  guard: ManualQaMutationGuard
  sendEvent: (event: TicketEvent) => void
}): Promise<ManualQaSummary> {
  const ticket = getTicketByRef(input.ticketId)
  const paths = getTicketPaths(input.ticketId)
  if (!ticket || !paths) throw new Error(`Ticket was not found: ${input.ticketId}`)
  const existingSummary = readManualQaSummary(paths.ticketDir, input.version)
  if (existingSummary && existingSummary.outcome !== 'failed') return existingSummary
  const draft = ManualQaDraftSchema.parse(input.draft)
  assertMutationGuard(input.ticketId, paths.ticketDir, input.version, draft, input.guard)
  const checklist = readManualQaChecklist(paths.ticketDir, input.version)
  if (!checklist) throw new Error('Manual QA checklist was not found.')
  validateSubmission(checklist, draft)
  const drift = detectManualQaWorkspaceDrift(input.ticketId, input.version)
  if (drift.drifted) {
    const error = new Error('Manual QA workspace changed during user verification; include or discard audited files before submitting.')
    Object.assign(error, { code: 'MANUAL_QA_WORKSPACE_DRIFT', drift })
    throw error
  }

  snapshotManualQaDraft(paths.ticketDir, draft)
  const evidence = readManualQaEvidenceIndex(paths.ticketDir, input.version)
  const results: ManualQaResults = {
    ...draft,
    artifact: 'manual_qa_results',
    actionId: input.guard.actionId,
    submittedAt: new Date().toISOString(),
  }
  persistManualQaResults(paths.ticketDir, results)
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_draft', draft, input.guard.actionId)
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_results', results, input.guard.actionId)
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_submission_idempotency', {
    actionId: input.guard.actionId,
    version: input.version,
    checklistHash: input.guard.expectedChecklistHash,
    draftRevision: input.guard.expectedDraftRevision,
  }, input.guard.actionId)
  const operationPath = getManualQaStoragePaths(paths.ticketDir, input.version).operationPath
  const journal = reserveManualQaSubmissionOperation({
    path: operationPath,
    actionId: input.guard.actionId,
    ticketId: input.ticketId,
    version: input.version,
    checklistHash: input.guard.expectedChecklistHash,
    draftRevision: input.guard.expectedDraftRevision,
  })
  persistManualQaDatabaseOperation(input.ticketId, journal)

  const itemById = new Map(checklist.items.map((item) => [item.id, item]))
  journal.state = 'creating_improvements'
  journal.updatedAt = new Date().toISOString()
  writeJournal(operationPath, journal)
  persistManualQaDatabaseOperation(input.ticketId, journal)
  for (const result of draft.results.filter((entry) => entry.outcome === 'improvement')) {
    const improvement = draft.improvements.find((entry) => entry.id === result.improvementDraftId)!
    const deterministicOrigin = `manual-qa:${ticket.externalId}:v${input.version}:${improvement.id}`
    const existing = findExistingImprovement(ticket.projectId, deterministicOrigin)
    const ticketId = existing?.id ?? createImprovementTicket({
      sourceTicketId: input.ticketId,
      sourceExternalId: ticket.externalId,
      sourceTicketDir: paths.ticketDir,
      projectId: ticket.projectId,
      version: input.version,
      actionId: input.guard.actionId,
      draft: improvement,
      item: itemById.get(result.itemId)!,
      result,
      evidence: evidenceForIds(evidence, improvement.evidenceIds),
    })
    if (!journal.improvementTicketIds.includes(ticketId)) {
      journal.improvementTicketIds.push(ticketId)
      journal.updatedAt = new Date().toISOString()
      writeJournal(operationPath, journal)
      persistManualQaDatabaseOperation(input.ticketId, journal)
    }
  }
  const improvementReceipt = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    actionId: input.guard.actionId,
    version: input.version,
    ticketIds: journal.improvementTicketIds,
    createdAt: new Date().toISOString(),
  }
  safeAtomicWrite(getManualQaStoragePaths(paths.ticketDir, input.version).improvementTicketReceiptPath, JSON.stringify(improvementReceipt, null, 2))
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_improvement_ticket_receipt', improvementReceipt, input.guard.actionId)

  const failed = draft.results.filter((result) => result.outcome === 'fail')
  if (failed.length > 0 && existingSummary?.outcome !== 'failed') {
    const intermediate: ManualQaSummary = {
      schemaVersion: MANUAL_QA_SCHEMA_VERSION,
      artifact: 'manual_qa_summary',
      ticketId: ticket.externalId,
      version: input.version,
      outcome: 'failed',
      createdFixBeadIds: [],
      improvementTicketIds: journal.improvementTicketIds,
      waivedItemIds: draft.results.filter((entry) => entry.outcome === 'waive').map((entry) => entry.itemId),
      completedAt: new Date().toISOString(),
    }
    persistManualQaSummary(paths.ticketDir, intermediate)
    persistSummaryArtifact(input.ticketId, intermediate)
  }

  const existingBeads = readJsonl<Bead>(paths.beadsPath)
  const fixBeads = buildQaFixBeads({
    existing: existingBeads,
    checklist,
    results: draft.results,
    evidence,
    ticketId: input.ticketId,
    externalId: ticket.externalId,
    version: input.version,
    actionId: input.guard.actionId,
    imageDelivery: await resolveQaImageDelivery(ticket.lockedMainImplementer, evidence),
  })
  journal.state = 'creating_beads'
  journal.fixBeadIds = fixBeads.map((bead) => bead.id)
  journal.updatedAt = new Date().toISOString()
  writeJournal(operationPath, journal)
  persistManualQaDatabaseOperation(input.ticketId, journal)
  if (fixBeads.length > 0) {
    const existingIds = new Set(existingBeads.map((bead) => bead.id))
    writeJsonl(paths.beadsPath, [...existingBeads, ...fixBeads.filter((bead) => !existingIds.has(bead.id))])
  }

  const beadReceipt = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    actionId: input.guard.actionId,
    version: input.version,
    beadIds: journal.fixBeadIds,
    createdAt: new Date().toISOString(),
  }
  safeAtomicWrite(getManualQaStoragePaths(paths.ticketDir, input.version).beadCreationReceiptPath, JSON.stringify(beadReceipt, null, 2))
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_bead_creation_receipt', beadReceipt, input.guard.actionId)

  const waivedItemIds = draft.results.filter((result) => result.outcome === 'waive').map((result) => result.itemId)
  const requiredWaivers = waivedItemIds.filter((itemId) => itemById.get(itemId)?.required)
  const summary: ManualQaSummary = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    artifact: 'manual_qa_summary',
    ticketId: ticket.externalId,
    version: input.version,
    outcome: failed.length > 0 ? 'created_fixes' : requiredWaivers.length > 0 ? 'waived_through' : 'passed',
    createdFixBeadIds: journal.fixBeadIds,
    improvementTicketIds: journal.improvementTicketIds,
    waivedItemIds,
    completedAt: new Date().toISOString(),
  }
  persistManualQaSummary(paths.ticketDir, summary)
  persistSummaryArtifact(input.ticketId, summary)
  journal.state = 'complete'
  journal.updatedAt = new Date().toISOString()
  writeJournal(operationPath, journal)
  persistManualQaDatabaseOperation(input.ticketId, journal)
  if (failed.length > 0) {
    patchTicket(input.ticketId, {
      totalBeads: existingBeads.length + fixBeads.filter((bead) => !existingBeads.some((existingBead) => existingBead.id === bead.id)).length,
      currentBead: existingBeads.filter((bead) => bead.status === 'done').length,
    })
    archiveActivePhaseAttempts(
      input.ticketId,
      ['RUNNING_FINAL_TEST', 'GENERATING_QA_CHECKLIST', 'WAITING_MANUAL_QA'],
      'manual_qa_fixes_created',
    )
    createFreshPhaseAttempts(input.ticketId, ['RUNNING_FINAL_TEST', 'GENERATING_QA_CHECKLIST', 'WAITING_MANUAL_QA'])
  }
  input.sendEvent({ type: failed.length > 0 ? 'MANUAL_QA_FIXES_CREATED' : 'MANUAL_QA_COMPLETE' })
  return summary
}

export async function skipManualQa(input: {
  ticketId: string
  version: number
  draft: ManualQaDraft
  guard: ManualQaMutationGuard
  reason?: string
  sendEvent: (event: TicketEvent) => void
}): Promise<ManualQaSummary> {
  const ticket = getTicketByRef(input.ticketId)
  const ticketDir = resolveManualQaTicketDir(input.ticketId)
  if (!ticket) throw new Error(`Ticket was not found: ${input.ticketId}`)
  const existing = readManualQaSummary(ticketDir, input.version)
  if (existing) return existing
  const draft = ManualQaDraftSchema.parse(input.draft)
  assertMutationGuard(input.ticketId, ticketDir, input.version, draft, input.guard)
  const drift = detectManualQaWorkspaceDrift(input.ticketId, input.version)
  if (drift.drifted) {
    const error = new Error('Manual QA workspace changed during user verification; include or discard audited files before skipping.')
    Object.assign(error, { code: 'MANUAL_QA_WORKSPACE_DRIFT', drift })
    throw error
  }
  snapshotManualQaDraft(ticketDir, draft)
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_draft', draft, input.guard.actionId)
  const now = new Date().toISOString()
  persistManualQaDatabaseOperation(input.ticketId, {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    actionId: input.guard.actionId,
    ticketId: input.ticketId,
    version: input.version,
    checklistHash: input.guard.expectedChecklistHash,
    draftRevision: input.guard.expectedDraftRevision,
    state: 'complete',
    improvementTicketIds: [],
    fixBeadIds: [],
    createdAt: now,
    updatedAt: now,
  })
  safeAtomicWrite(getManualQaStoragePaths(ticketDir, input.version).skipReceiptPath, [
    `schemaVersion: ${MANUAL_QA_SCHEMA_VERSION}`,
    'artifact: manual_qa_skip_receipt',
    `ticketId: ${JSON.stringify(ticket.externalId)}`,
    `version: ${input.version}`,
    `actionId: ${JSON.stringify(input.guard.actionId)}`,
    `reason: ${JSON.stringify(input.reason ?? '')}`,
    `createdAt: ${JSON.stringify(now)}`,
    '',
  ].join('\n'))
  const summary: ManualQaSummary = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    artifact: 'manual_qa_summary',
    ticketId: ticket.externalId,
    version: input.version,
    outcome: 'skipped',
    createdFixBeadIds: [],
    improvementTicketIds: [],
    waivedItemIds: [],
    ...(input.reason?.trim() ? { skipReason: input.reason.trim() } : {}),
    completedAt: now,
  }
  persistManualQaSummary(ticketDir, summary)
  persistManualQaPhaseArtifact(input.ticketId, 'manual_qa_skip_receipt', {
    actionId: input.guard.actionId,
    version: input.version,
    reason: input.reason ?? '',
    createdAt: now,
  }, input.guard.actionId)
  persistSummaryArtifact(input.ticketId, summary)
  input.sendEvent({ type: 'MANUAL_QA_SKIPPED' })
  return summary
}
