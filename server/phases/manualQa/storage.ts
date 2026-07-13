import { createHash, randomUUID } from 'node:crypto'
import {
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, extname, resolve, sep } from 'node:path'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { buildYamlDocument, parseYamlOrJsonCandidate } from '../../structuredOutput/yamlUtils'
import { contentSha256 } from '../../lib/contentHash'
import { getTicketPaths } from '../../storage/tickets'
import {
  MANUAL_QA_SCHEMA_VERSION,
  MAX_MANUAL_QA_EVIDENCE_BYTES,
  ManualQaChecklistSchema,
  ManualQaCoverageSchema,
  ManualQaDraftSchema,
  ManualQaEvidenceRefSchema,
  ManualQaResultsSchema,
  ManualQaSummarySchema,
  type ManualQaChecklist,
  type ManualQaCoverage,
  type ManualQaDraft,
  type ManualQaEvidenceRef,
  type ManualQaGenerationReservation,
  type ManualQaResults,
  type ManualQaSummary,
} from './types'

const SAFE_RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export interface ManualQaStoragePaths {
  root: string
  versionDir: string
  checklistPath: string
  resultsPath: string
  summaryPath: string
  coveragePath: string
  skipReceiptPath: string
  operationPath: string
  beadCreationReceiptPath: string
  improvementTicketReceiptPath: string
  evidenceDir: string
  evidenceIndexPath: string
  reservationPath: string
  baselinePath: string
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new Error('Manual QA version must be a positive integer.')
}

export function getManualQaStoragePaths(ticketDir: string, version: number): ManualQaStoragePaths {
  assertVersion(version)
  const root = resolve(ticketDir, 'manual-qa')
  const versionDir = resolve(root, `v${version}`)
  return {
    root,
    versionDir,
    checklistPath: resolve(versionDir, 'checklist.yaml'),
    resultsPath: resolve(versionDir, 'results.yaml'),
    summaryPath: resolve(versionDir, 'summary.yaml'),
    coveragePath: resolve(versionDir, 'coverage.yaml'),
    skipReceiptPath: resolve(versionDir, 'skip-receipt.yaml'),
    operationPath: resolve(versionDir, 'submission-operation.json'),
    beadCreationReceiptPath: resolve(versionDir, 'bead-creation-receipt.yaml'),
    improvementTicketReceiptPath: resolve(versionDir, 'improvement-ticket-receipt.yaml'),
    evidenceDir: resolve(versionDir, 'evidence'),
    evidenceIndexPath: resolve(versionDir, 'evidence', 'index.json'),
    reservationPath: resolve(root, `generation-reservation-v${version}.json`),
    baselinePath: resolve(root, `workspace-baseline-v${version}.json`),
  }
}

export function resolveManualQaTicketDir(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket storage was not found: ${ticketId}`)
  return paths.ticketDir
}

function writeYaml(path: string, value: unknown): void {
  safeAtomicWrite(path, buildYamlDocument(value))
}

function readYaml<T>(path: string, parser: { parse(value: unknown): T }): T | null {
  if (!existsSync(path)) return null
  return parser.parse(parseYamlOrJsonCandidate(readFileSync(path, 'utf8')))
}

export function persistManualQaChecklist(ticketDir: string, checklist: ManualQaChecklist): string {
  const parsed = ManualQaChecklistSchema.parse(checklist)
  const path = getManualQaStoragePaths(ticketDir, parsed.version).checklistPath
  writeYaml(path, parsed)
  return contentSha256(readFileSync(path, 'utf8'))
}

export function readManualQaChecklist(ticketDir: string, version: number): ManualQaChecklist | null {
  return readYaml(getManualQaStoragePaths(ticketDir, version).checklistPath, ManualQaChecklistSchema)
}

export function getManualQaChecklistHash(ticketDir: string, version: number): string | null {
  const path = getManualQaStoragePaths(ticketDir, version).checklistPath
  return existsSync(path) ? contentSha256(readFileSync(path, 'utf8')) : null
}

export function persistManualQaCoverage(ticketDir: string, coverage: ManualQaCoverage): void {
  const parsed = ManualQaCoverageSchema.parse(coverage)
  writeYaml(getManualQaStoragePaths(ticketDir, parsed.version).coveragePath, parsed)
}

export function readManualQaCoverage(ticketDir: string, version: number): ManualQaCoverage | null {
  return readYaml(getManualQaStoragePaths(ticketDir, version).coveragePath, ManualQaCoverageSchema)
}

export function persistManualQaResults(ticketDir: string, results: ManualQaResults): void {
  const parsed = ManualQaResultsSchema.parse(results)
  writeYaml(getManualQaStoragePaths(ticketDir, parsed.version).resultsPath, parsed)
}

export function readManualQaResults(ticketDir: string, version: number): ManualQaResults | null {
  return readYaml(getManualQaStoragePaths(ticketDir, version).resultsPath, ManualQaResultsSchema)
}

export function persistManualQaSummary(ticketDir: string, summary: ManualQaSummary): void {
  const parsed = ManualQaSummarySchema.parse(summary)
  writeYaml(getManualQaStoragePaths(ticketDir, parsed.version).summaryPath, parsed)
}

export function readManualQaSummary(ticketDir: string, version: number): ManualQaSummary | null {
  return readYaml(getManualQaStoragePaths(ticketDir, version).summaryPath, ManualQaSummarySchema)
}

export function snapshotManualQaDraft(ticketDir: string, draft: ManualQaDraft): ManualQaDraft {
  const parsed = ManualQaDraftSchema.parse(draft)
  const snapshotPath = resolve(getManualQaStoragePaths(ticketDir, parsed.version).versionDir, 'manual-qa-draft.yaml')
  if (!existsSync(snapshotPath)) writeYaml(snapshotPath, parsed)
  return parsed
}

export function reserveManualQaVersion(
  ticketDir: string,
  ticketId: string,
  version: number,
  actionId: string = randomUUID(),
): ManualQaGenerationReservation {
  const paths = getManualQaStoragePaths(ticketDir, version)
  mkdirSync(paths.versionDir, { recursive: true })
  if (existsSync(paths.reservationPath)) {
    const existing = JSON.parse(readFileSync(paths.reservationPath, 'utf8')) as ManualQaGenerationReservation
    if (existing.ticketId !== ticketId || existing.version !== version) {
      throw new Error('Manual QA generation reservation does not match the requested ticket/version.')
    }
    return existing
  }
  const reservation: ManualQaGenerationReservation = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    ticketId,
    version,
    actionId,
    state: 'reserved',
    createdAt: new Date().toISOString(),
  }
  safeAtomicWrite(paths.reservationPath, JSON.stringify(reservation, null, 2))
  return reservation
}

export function completeManualQaReservation(ticketDir: string, reservation: ManualQaGenerationReservation, checklistHash: string): void {
  safeAtomicWrite(
    getManualQaStoragePaths(ticketDir, reservation.version).reservationPath,
    JSON.stringify({
      ...reservation,
      state: 'complete',
      completedAt: new Date().toISOString(),
      checklistHash,
    } satisfies ManualQaGenerationReservation, null, 2),
  )
}

export function listManualQaVersions(ticketDir: string): number[] {
  const root = resolve(ticketDir, 'manual-qa')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v[1-9]\d*$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(1)))
    .sort((left, right) => left - right)
}

export function allocateNextManualQaVersion(ticketDir: string): number {
  return (listManualQaVersions(ticketDir).at(-1) ?? 0) + 1
}

export function readManualQaEvidenceIndex(ticketDir: string, version: number): ManualQaEvidenceRef[] {
  const path = getManualQaStoragePaths(ticketDir, version).evidenceIndexPath
  if (!existsSync(path)) return []
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  return ManualQaEvidenceRefSchema.array().parse(value)
}

export interface ManualQaEvidenceActionReceipt {
  schemaVersion: 1
  actionId: string
  operation: 'upload' | 'remove'
  evidence: ManualQaEvidenceRef
  createdAt: string
}

function evidenceActionReceiptPath(ticketDir: string, version: number, actionId: string): string {
  const safeId = actionId.replace(/[^A-Za-z0-9._-]/g, '_')
  return resolve(getManualQaStoragePaths(ticketDir, version).evidenceDir, 'operations', `${safeId}.json`)
}

export function readManualQaEvidenceActionReceipt(
  ticketDir: string,
  version: number,
  actionId: string,
): ManualQaEvidenceActionReceipt | null {
  const path = evidenceActionReceiptPath(ticketDir, version, actionId)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as ManualQaEvidenceActionReceipt : null
}

export function persistManualQaEvidenceActionReceipt(
  ticketDir: string,
  version: number,
  actionId: string,
  operation: ManualQaEvidenceActionReceipt['operation'],
  evidence: ManualQaEvidenceRef,
): ManualQaEvidenceActionReceipt {
  const existing = readManualQaEvidenceActionReceipt(ticketDir, version, actionId)
  if (existing) {
    if (existing.operation !== operation) throw new Error('Evidence action ID was already used for another operation.')
    return existing
  }
  const receipt: ManualQaEvidenceActionReceipt = {
    schemaVersion: MANUAL_QA_SCHEMA_VERSION,
    actionId,
    operation,
    evidence: ManualQaEvidenceRefSchema.parse(evidence),
    createdAt: new Date().toISOString(),
  }
  safeAtomicWrite(evidenceActionReceiptPath(ticketDir, version, actionId), JSON.stringify(receipt, null, 2))
  return receipt
}

function writeEvidenceIndex(ticketDir: string, version: number, entries: ManualQaEvidenceRef[]): void {
  safeAtomicWrite(
    getManualQaStoragePaths(ticketDir, version).evidenceIndexPath,
    JSON.stringify(ManualQaEvidenceRefSchema.array().parse(entries), null, 2),
  )
}

export function sanitizeEvidenceName(input: string): string {
  const withoutControls = basename(input.replace(/\\/g, '/'))
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
  const normalized = withoutControls
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return (normalized || 'evidence').slice(0, 180)
}

export function isSafeRasterMediaType(mediaType: string): boolean {
  return SAFE_RASTER_TYPES.has(mediaType.toLowerCase())
}

async function assertContainedDirectory(directory: string, root: string): Promise<void> {
  mkdirSync(directory, { recursive: true })
  const resolvedRoot = await realpath(root)
  const resolvedDirectory = await realpath(directory)
  if (resolvedDirectory !== resolvedRoot && !resolvedDirectory.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Evidence directory escaped Manual QA storage containment.')
  }
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Evidence directories cannot be symlinks.')
}

export async function streamManualQaEvidence(input: {
  ticketDir: string
  version: number
  itemId: string
  evidenceId: string
  originalName: string
  mediaType: string
  body: ReadableStream<Uint8Array> | null
}): Promise<ManualQaEvidenceRef> {
  if (!input.body) throw new Error('Evidence upload body is required.')
  const evidenceId = input.evidenceId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(evidenceId)) throw new Error('Invalid evidence ID.')
  const itemId = input.itemId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(itemId)) throw new Error('Invalid checklist item ID.')

  const paths = getManualQaStoragePaths(input.ticketDir, input.version)
  await assertContainedDirectory(paths.evidenceDir, paths.root)
  const existing = readManualQaEvidenceIndex(input.ticketDir, input.version)
  if (existing.some((entry) => entry.id === evidenceId)) throw new Error(`Evidence ID already exists: ${evidenceId}`)

  const originalName = sanitizeEvidenceName(input.originalName)
  const extension = extname(originalName).slice(0, 24)
  const itemDirectoryName = `item-${itemId.replace(/[^A-Za-z0-9._-]/g, '_')}`
  const itemDirectory = resolve(paths.evidenceDir, itemDirectoryName)
  await assertContainedDirectory(itemDirectory, paths.evidenceDir)
  const fileName = `${evidenceId}${extension}`
  const storedName = `${itemDirectoryName}/${fileName}`
  const finalPath = resolve(itemDirectory, fileName)
  const temporaryPath = resolve(itemDirectory, `.${evidenceId}.${randomUUID()}.upload`)
  if (!finalPath.startsWith(`${itemDirectory}${sep}`) || !temporaryPath.startsWith(`${itemDirectory}${sep}`)) {
    throw new Error('Evidence path escaped Manual QA storage containment.')
  }

  const handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
  const reader = input.body.getReader()
  const hash = createHash('sha256')
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_MANUAL_QA_EVIDENCE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`Evidence file exceeds ${MAX_MANUAL_QA_EVIDENCE_BYTES} bytes.`)
      }
      hash.update(value)
      await handle.write(value)
    }
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    rmSync(temporaryPath, { force: true })
    throw error
  } finally {
    reader.releaseLock()
  }
  await handle.close()
  if (existsSync(finalPath) || lstatSync(temporaryPath).isSymbolicLink()) {
    rmSync(temporaryPath, { force: true })
    throw new Error('Evidence destination already exists or is unsafe.')
  }
  renameSync(temporaryPath, finalPath)

  const mediaType = (input.mediaType || 'application/octet-stream').trim().toLowerCase()
  const metadata = ManualQaEvidenceRefSchema.parse({
    id: evidenceId,
    itemId,
    originalName,
    storedName,
    mediaType,
    size,
    sha256: hash.digest('hex'),
    inlinePreview: isSafeRasterMediaType(mediaType),
    createdAt: new Date().toISOString(),
  })
  writeEvidenceIndex(input.ticketDir, input.version, [...existing, metadata])
  return metadata
}

export function resolveManualQaEvidence(input: {
  ticketDir: string
  version: number
  itemId: string
  evidenceId: string
}): { metadata: ManualQaEvidenceRef; path: string } {
  const metadata = readManualQaEvidenceIndex(input.ticketDir, input.version)
    .find((entry) => entry.id === input.evidenceId && entry.itemId === input.itemId)
  if (!metadata) throw new Error('Evidence was not found.')
  const evidenceDir = getManualQaStoragePaths(input.ticketDir, input.version).evidenceDir
  const path = resolve(evidenceDir, metadata.storedName)
  if (!path.startsWith(`${evidenceDir}${sep}`) || !existsSync(path) || lstatSync(path).isSymbolicLink()) {
    throw new Error('Evidence path is unsafe or missing.')
  }
  return { metadata, path }
}

export function getManualQaEvidenceRelativePath(version: number, evidence: Pick<ManualQaEvidenceRef, 'storedName'>): string {
  assertVersion(version)
  return `manual-qa/v${version}/evidence/${evidence.storedName}`
}

export function removeManualQaEvidence(input: {
  ticketDir: string
  version: number
  itemId: string
  evidenceId: string
}): ManualQaEvidenceRef {
  const resolved = resolveManualQaEvidence(input)
  rmSync(resolved.path, { force: true })
  const remaining = readManualQaEvidenceIndex(input.ticketDir, input.version)
    .filter((entry) => entry.id !== input.evidenceId)
  writeEvidenceIndex(input.ticketDir, input.version, remaining)
  return resolved.metadata
}

export interface ManualQaVersionDetail {
  checklist: ManualQaChecklist | null
  checklistHash: string | null
  coverage: ManualQaCoverage | null
  results: ManualQaResults | null
  summary: ManualQaSummary | null
  evidence: ManualQaEvidenceRef[]
}

export function getManualQaVersionDetail(ticketDir: string, version: number): ManualQaVersionDetail {
  return {
    checklist: readManualQaChecklist(ticketDir, version),
    checklistHash: getManualQaChecklistHash(ticketDir, version),
    coverage: readManualQaCoverage(ticketDir, version),
    results: readManualQaResults(ticketDir, version),
    summary: readManualQaSummary(ticketDir, version),
    evidence: readManualQaEvidenceIndex(ticketDir, version),
  }
}

export function buildManualQaProjection(ticketId: string) {
  const ticketDir = resolveManualQaTicketDir(ticketId)
  const versions = listManualQaVersions(ticketDir)
  const activeVersion = versions.findLast((version) => !readManualQaSummary(ticketDir, version)) ?? versions.at(-1) ?? null
  const summaries = versions.map((version) => readManualQaSummary(ticketDir, version)).filter((value): value is ManualQaSummary => Boolean(value))
  return {
    activeVersion,
    completedRoundCount: summaries.length,
    latestOutcome: summaries.at(-1)?.outcome ?? null,
    artifactAvailable: activeVersion !== null && readManualQaChecklist(ticketDir, activeVersion) !== null,
    versions,
    ...(activeVersion !== null ? { current: getManualQaVersionDetail(ticketDir, activeVersion) } : {}),
  }
}
