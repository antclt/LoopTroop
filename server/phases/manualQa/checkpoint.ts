import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  captureFinalTestDirtyFiles,
  resolveFinalTestCandidateFiles,
  type FinalTestDirtyFile,
} from '../finalTest/fileEffectsAudit'
import { getTicketByRef, getTicketPaths } from '../../storage/tickets'
import { FINAL_TEST_FILE_EFFECTS_ERROR_CODE } from '@shared/finalTestFileEffects'

export class ManualQaCheckpointBlockedError extends Error {
  readonly code = FINAL_TEST_FILE_EFFECTS_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = 'ManualQaCheckpointBlockedError'
  }
}

export interface ManualQaWorkspaceBaseline {
  schemaVersion: 1
  version: number
  createdAt: string
  head: string
  status: FinalTestDirtyFile[]
  trackedSignatures: Record<string, string>
}

export interface ManualQaCheckpointResult {
  baseline: ManualQaWorkspaceBaseline
  checkpointCommit: string | null
  candidateFiles: string[]
  quarantinedFiles: string[]
}

interface ManualQaDriftReceipt {
  schemaVersion: 1
  actionId: string
  version: number
  decision: 'include' | 'discard'
  files: string[]
  previousHead: string
  resultingHead: string
  createdAt: string
}

const EXCLUDED_PATHSPECS = ['.', ':(top,exclude).ticket', ':(top,exclude).looptroop'] as const

function normalizeProjectPath(filePath: string): string | null {
  const trimmed = filePath.trim().replace(/\\/g, '/')
  const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
    || normalized === '.ticket'
    || normalized.startsWith('.ticket/')
    || normalized === '.looptroop'
    || normalized.startsWith('.looptroop/')
    || normalized.includes('\0')
    || normalized.includes('\n')
    || normalized.includes('\r')
  ) return null
  return normalized
}

function uniqueProjectPaths(files: string[]): string[] {
  return [...new Set(files.map(normalizeProjectPath).filter((file): file is string => file !== null))]
}

function literalPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

function runGit(worktreePath: string, args: string[], allowEmpty = false): string {
  const result = spawnSync('git', ['-C', worktreePath, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
    },
  })
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message
      ?? ((result.stderr ?? '').trim() || `exit code ${result.status ?? '?'}`)
    throw new Error(`git ${args[0] ?? ''} failed: ${detail}`)
  }
  const output = (result.stdout ?? '').trim()
  if (!allowEmpty && !output && args[0] === 'rev-parse') {
    throw new Error(`git ${args.join(' ')} returned no result`)
  }
  return output
}

function assertContained(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error(`Manual QA path escapes its contained root: ${target}`)
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
}

function baselinePath(ticketDir: string, version: number): string {
  return join(ticketDir, 'manual-qa', `workspace-baseline-v${version}.json`)
}

function driftReceiptPath(ticketDir: string, actionId: string): string {
  const safeActionId = actionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(ticketDir, 'manual-qa', `workspace-drift-${safeActionId}.json`)
}

function readReceipt(path: string): ManualQaDriftReceipt | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ManualQaDriftReceipt
  } catch {
    throw new Error(`Manual QA drift receipt is invalid: ${path}`)
  }
}

function captureTrackedSignatures(worktreePath: string): Record<string, string> {
  const output = runGit(worktreePath, ['ls-files', '-s', '-z'], true)
  const signatures: Record<string, string> = {}
  for (const entry of output.split('\0')) {
    if (!entry) continue
    const match = entry.match(/^\d+ ([0-9a-f]+) \d+\t(.+)$/)
    if (!match?.[1] || !match[2]) continue
    const path = normalizeProjectPath(match[2])
    if (path) signatures[path] = match[1]
  }
  return signatures
}

function captureBaseline(worktreePath: string, version: number): ManualQaWorkspaceBaseline {
  return {
    schemaVersion: 1,
    version,
    createdAt: new Date().toISOString(),
    head: runGit(worktreePath, ['rev-parse', 'HEAD']),
    status: captureFinalTestDirtyFiles(worktreePath),
    trackedSignatures: captureTrackedSignatures(worktreePath),
  }
}

function readBaseline(ticketDir: string, version: number): ManualQaWorkspaceBaseline {
  const path = baselinePath(ticketDir, version)
  if (!existsSync(path)) throw new Error(`Manual QA workspace baseline is missing for v${version}`)
  const value = JSON.parse(readFileSync(path, 'utf8')) as ManualQaWorkspaceBaseline
  if (value.schemaVersion !== 1 || value.version !== version || !value.head) {
    throw new Error(`Manual QA workspace baseline is invalid for v${version}`)
  }
  return value
}

function captureCommittedDrift(worktreePath: string, baselineHead: string, currentHead: string): Map<string, string> {
  if (baselineHead === currentHead) return new Map()
  const output = runGit(worktreePath, [
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    `${baselineHead}..${currentHead}`,
    '--',
    ...EXCLUDED_PATHSPECS,
  ], true)
  const fields = output.split('\0').filter(Boolean)
  const drift = new Map<string, string>()
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? ''
    const path = normalizeProjectPath(fields[index + 1] ?? '')
    if (path) drift.set(path, status[0] ?? 'M')
  }
  return drift
}

function quarantineFiles(
  worktreePath: string,
  ticketDir: string,
  version: number,
  files: string[],
): string[] {
  const quarantineRoot = join(ticketDir, 'manual-qa', `v${version}`, 'quarantine')
  const quarantined: string[] = []
  for (const file of uniqueProjectPaths(files)) {
    const source = resolve(worktreePath, file)
    const destination = resolve(quarantineRoot, file)
    assertContained(worktreePath, source)
    assertContained(quarantineRoot, destination)
    if (!existsSync(source) && !lstatSafe(source)) continue
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: false, force: true })
    quarantined.push(file)
  }
  return quarantined
}

function lstatSafe(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

function discardExactFiles(worktreePath: string, files: string[], dirtyFiles: FinalTestDirtyFile[]): void {
  const dirtyByPath = new Map(dirtyFiles.map(file => [file.path, file]))
  const normalizedFiles = uniqueProjectPaths(files).filter(file => dirtyByPath.has(file))
  const tracked = normalizedFiles.filter(file => !dirtyByPath.get(file)?.untracked)
  const untracked = normalizedFiles.filter(file => dirtyByPath.get(file)?.untracked)
  if (tracked.length > 0) {
    runGit(worktreePath, ['restore', '--staged', '--worktree', '--', ...tracked.map(literalPathspec)], true)
  }
  if (untracked.length > 0) {
    runGit(worktreePath, ['clean', '-fd', '--', ...untracked.map(literalPathspec)], true)
  }
}

function commitExactFiles(worktreePath: string, files: string[], message: string): string | null {
  const normalizedFiles = uniqueProjectPaths(files)
  if (normalizedFiles.length === 0) return null
  runGit(worktreePath, ['add', '-A', '--', ...normalizedFiles.map(literalPathspec)], true)
  const staged = runGit(worktreePath, ['diff', '--cached', '--name-only', '--', ...EXCLUDED_PATHSPECS], true)
  if (!staged) return null
  runGit(worktreePath, [
    '-c',
    'user.name=LoopTroop',
    '-c',
    'user.email=looptroop@local',
    'commit',
    '--no-verify',
    '-m',
    message,
  ], true)
  return runGit(worktreePath, ['rev-parse', 'HEAD'])
}

export function prepareManualQaCheckpoint(ticketId: string, version: number): ManualQaCheckpointResult {
  const paths = getTicketPaths(ticketId)
  const ticket = getTicketByRef(ticketId)
  if (!paths || !ticket) throw new Error(`Ticket workspace not initialized: ${ticketId}`)
  if (!Number.isInteger(version) || version < 1) throw new Error('Manual QA version must be a positive integer')

  const existingBaselinePath = baselinePath(paths.ticketDir, version)
  if (existsSync(existingBaselinePath)) {
    const baseline = JSON.parse(readFileSync(existingBaselinePath, 'utf8')) as ManualQaWorkspaceBaseline
    const currentStatus = captureFinalTestDirtyFiles(paths.worktreePath)
    if (baseline.head === runGit(paths.worktreePath, ['rev-parse', 'HEAD']) && currentStatus.length === 0) {
      return { baseline, checkpointCommit: baseline.head, candidateFiles: [], quarantinedFiles: [] }
    }
  }

  const resolution = resolveFinalTestCandidateFiles(ticketId)
  if (!resolution.ok) {
    throw new ManualQaCheckpointBlockedError(
      resolution.message ?? 'Final-test file effects require a user decision',
    )
  }

  const audit = resolution.audit
  const candidateFiles = uniqueProjectPaths(resolution.candidateFiles)
  const checkpointCommit = commitExactFiles(
    paths.worktreePath,
    candidateFiles,
    `${ticket.externalId}: checkpoint accepted final-test effects for Manual QA v${version}`,
  )

  const currentDirtyFiles = captureFinalTestDirtyFiles(paths.worktreePath)
  const removableFiles = uniqueProjectPaths([
    ...(audit?.temporaryFiles ?? []),
    ...(audit?.unexpectedFiles ?? []),
    ...(audit?.baselineDirtyFiles.map(file => file.path) ?? []),
    ...(resolution.override?.decision === 'discard_unclassified' ? resolution.override.files : []),
  ]).filter(file => !candidateFiles.includes(file))
  const quarantinedFiles = quarantineFiles(paths.worktreePath, paths.ticketDir, version, removableFiles)
  discardExactFiles(paths.worktreePath, removableFiles, currentDirtyFiles)

  const remainingStatus = captureFinalTestDirtyFiles(paths.worktreePath)
  if (remainingStatus.length > 0) {
    throw new Error(`Manual QA checkpoint requires a clean worktree; remaining files: ${remainingStatus.map(file => file.path).join(', ')}`)
  }

  const baseline = captureBaseline(paths.worktreePath, version)
  atomicWriteJson(existingBaselinePath, baseline)
  return { baseline, checkpointCommit, candidateFiles, quarantinedFiles }
}

function applyManualQaDriftDecision(
  ticketId: string,
  version: number,
  files: string[],
  actionId: string,
  decision: ManualQaDriftReceipt['decision'],
): ManualQaDriftReceipt {
  const paths = getTicketPaths(ticketId)
  const ticket = getTicketByRef(ticketId)
  if (!paths || !ticket) throw new Error(`Ticket workspace not initialized: ${ticketId}`)
  if (!actionId.trim()) throw new Error('Manual QA workspace decision requires an action ID')
  const receiptPath = driftReceiptPath(paths.ticketDir, actionId)
  const existing = readReceipt(receiptPath)
  if (existing) return existing

  const requestedFiles = uniqueProjectPaths(files)
  const currentDirty = captureFinalTestDirtyFiles(paths.worktreePath)
  const currentDirtyPaths = new Set(currentDirty.map(file => file.path))
  const baseline = readBaseline(paths.ticketDir, version)
  const currentHead = runGit(paths.worktreePath, ['rev-parse', 'HEAD'])
  const committedDrift = captureCommittedDrift(paths.worktreePath, baseline.head, currentHead)
  const auditedFiles = new Set([...currentDirtyPaths, ...committedDrift.keys()])
  if (requestedFiles.some(file => !auditedFiles.has(file))) {
    throw new Error('Manual QA workspace decision may only include currently audited dirty files')
  }
  const unresolvedFiles = [...auditedFiles].filter(file => !requestedFiles.includes(file))
  if (unresolvedFiles.length > 0) {
    throw new Error(`Manual QA workspace decision must resolve every audited file: ${unresolvedFiles.join(', ')}`)
  }

  const previousHead = currentHead
  if (decision === 'include') {
    commitExactFiles(
      paths.worktreePath,
      requestedFiles,
      `${ticket.externalId}: include audited Manual QA workspace changes for v${version}`,
    )
  } else {
    quarantineFiles(paths.worktreePath, paths.ticketDir, version, requestedFiles)
    discardExactFiles(paths.worktreePath, requestedFiles, currentDirty)
    const committedFiles = requestedFiles.filter(file => committedDrift.has(file))
    const addedFiles = committedFiles.filter(file => committedDrift.get(file) === 'A')
    const restorableFiles = committedFiles.filter(file => committedDrift.get(file) !== 'A')
    if (restorableFiles.length > 0) {
      runGit(paths.worktreePath, [
        'restore',
        `--source=${baseline.head}`,
        '--staged',
        '--worktree',
        '--',
        ...restorableFiles.map(literalPathspec),
      ], true)
    }
    if (addedFiles.length > 0) {
      for (const file of addedFiles) {
        const target = resolve(paths.worktreePath, file)
        assertContained(paths.worktreePath, target)
        rmSync(target, { force: true, recursive: true })
      }
    }
    commitExactFiles(
      paths.worktreePath,
      committedFiles,
      `${ticket.externalId}: discard audited Manual QA workspace changes for v${version}`,
    )
  }

  const remainingStatus = captureFinalTestDirtyFiles(paths.worktreePath)
  if (remainingStatus.length > 0) {
    throw new Error(`Manual QA workspace still has unresolved drift: ${remainingStatus.map(file => file.path).join(', ')}`)
  }
  const nextBaseline = captureBaseline(paths.worktreePath, version)
  atomicWriteJson(baselinePath(paths.ticketDir, version), nextBaseline)
  const receipt: ManualQaDriftReceipt = {
    schemaVersion: 1,
    actionId,
    version,
    decision,
    files: requestedFiles,
    previousHead,
    resultingHead: nextBaseline.head,
    createdAt: new Date().toISOString(),
  }
  atomicWriteJson(receiptPath, receipt)
  return receipt
}

export function includeManualQaWorkspaceDrift(
  ticketId: string,
  version: number,
  files: string[],
  actionId: string,
): ManualQaDriftReceipt {
  return applyManualQaDriftDecision(ticketId, version, files, actionId, 'include')
}

export function discardManualQaWorkspaceDrift(
  ticketId: string,
  version: number,
  files: string[],
  actionId: string,
): ManualQaDriftReceipt {
  return applyManualQaDriftDecision(ticketId, version, files, actionId, 'discard')
}
