import { spawnSync } from 'node:child_process'
import { getLatestPhaseArtifact, insertPhaseArtifact } from '../../storage/tickets'
import {
  FINAL_TEST_FILE_EFFECTS_AUDIT_ARTIFACT,
  FINAL_TEST_FILE_EFFECTS_ERROR_CODE,
  FINAL_TEST_FILE_EFFECTS_OVERRIDE_ARTIFACT,
} from '@shared/finalTestFileEffects'

export {
  FINAL_TEST_FILE_EFFECTS_AUDIT_ARTIFACT,
  FINAL_TEST_FILE_EFFECTS_ERROR_CODE,
  FINAL_TEST_FILE_EFFECTS_OVERRIDE_ARTIFACT,
} from '@shared/finalTestFileEffects'

export type FinalTestFileEffectIntent = 'candidate' | 'temporary' | 'unexpected'

export interface FinalTestFileEffect {
  path: string
  intent: FinalTestFileEffectIntent
  reason?: string
}

export interface FinalTestDirtyFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  rawStatus: string
  untracked: boolean
  contentSignature: string | null
}

export interface FinalTestFileEffectsAudit {
  status: 'passed' | 'blocked'
  capturedAt: string
  baselineDirtyFiles: FinalTestDirtyFile[]
  dirtyFilesAfterTesting: FinalTestDirtyFile[]
  producedByFinalTesting: FinalTestDirtyFile[]
  declaredEffects: FinalTestFileEffect[]
  candidateFiles: string[]
  temporaryFiles: string[]
  unexpectedFiles: string[]
  unclassifiedFiles: string[]
  decisionRequiredFiles: string[]
  message: string
}

export interface FinalTestFileEffectsOverride {
  decision: 'include_unclassified_as_candidate' | 'discard_unclassified'
  files: string[]
  createdAt: string
  source: 'user'
}

export interface FinalTestCandidateResolution {
  ok: boolean
  candidateFiles: string[]
  audit?: FinalTestFileEffectsAudit
  override?: FinalTestFileEffectsOverride
  errorCode?: typeof FINAL_TEST_FILE_EFFECTS_ERROR_CODE
  message?: string
}

function normalizeAuditPath(filePath: string): string | null {
  const trimmed = filePath.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('\n') || trimmed.includes('\r')) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) return null

  const withoutDotPrefix = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  const segments = withoutDotPrefix.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (segments.some((segment) => segment === '.' || segment === '..')) return null

  const normalized = segments.join('/')
  if (
    normalized === '.ticket'
    || normalized.startsWith('.ticket/')
    || normalized === '.looptroop'
    || normalized.startsWith('.looptroop/')
  ) {
    return null
  }

  return normalized
}

function uniqueNormalizedPaths(files: string[]): string[] {
  return [...new Set(files.map(normalizeAuditPath).filter((file): file is string => file !== null))]
}

function toLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

function getContentSignature(worktreePath: string, filePath: string): string | null {
  const result = spawnSync('git', ['-C', worktreePath, 'hash-object', '--no-filters', '--', filePath], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) return null
  const hash = (result.stdout ?? '').trim()
  return hash || null
}

function parseGitStatusPorcelain(stdout: string, worktreePath: string): FinalTestDirtyFile[] {
  const entries = stdout.split('\0').filter(Boolean)
  const dirtyFiles: FinalTestDirtyFile[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? ''
    if (entry.length < 4) continue

    const indexStatus = entry[0] ?? ' '
    const worktreeStatus = entry[1] ?? ' '
    const rawPath = entry.slice(3)
    if ((indexStatus === 'R' || indexStatus === 'C') && index + 1 < entries.length) {
      index += 1
    }

    const path = normalizeAuditPath(rawPath)
    if (!path) continue

    dirtyFiles.push({
      path,
      indexStatus,
      worktreeStatus,
      rawStatus: `${indexStatus}${worktreeStatus}`,
      untracked: indexStatus === '?' && worktreeStatus === '?',
      contentSignature: getContentSignature(worktreePath, path),
    })
  }

  return dirtyFiles
}

export function captureFinalTestDirtyFiles(worktreePath: string): FinalTestDirtyFile[] {
  const result = spawnSync('git', [
    '-C',
    worktreePath,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    '.',
    ':(top,exclude).ticket',
    ':(top,exclude).looptroop',
  ], { encoding: 'utf8' })

  if (result.status !== 0 || result.error) {
    const detail = result.error?.message
      ?? ((result.stderr ?? '').trim() || `exit code ${result.status ?? '?'}`)
    throw new Error(`Failed to capture final-test dirty files: ${detail}`)
  }

  return parseGitStatusPorcelain(result.stdout ?? '', worktreePath)
}

function normalizeDeclaredEffects(effects: FinalTestFileEffect[]): FinalTestFileEffect[] {
  const normalizedEffects: FinalTestFileEffect[] = []
  const seen = new Set<string>()

  for (const effect of effects) {
    const path = normalizeAuditPath(effect.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalizedEffects.push({
      path,
      intent: effect.intent,
      ...(effect.reason ? { reason: effect.reason } : {}),
    })
  }

  return normalizedEffects
}

function hasDirtyFileChanged(before: FinalTestDirtyFile | undefined, after: FinalTestDirtyFile): boolean {
  if (!before) return true
  return before.rawStatus !== after.rawStatus || before.contentSignature !== after.contentSignature
}

export function buildFinalTestFileEffectsAudit(input: {
  baselineDirtyFiles: FinalTestDirtyFile[]
  dirtyFilesAfterTesting: FinalTestDirtyFile[]
  declaredEffects: FinalTestFileEffect[]
  capturedAt?: string
}): FinalTestFileEffectsAudit {
  const baselineByPath = new Map(input.baselineDirtyFiles.map((file) => [file.path, file]))
  const producedByFinalTesting = input.dirtyFilesAfterTesting
    .filter((file) => hasDirtyFileChanged(baselineByPath.get(file.path), file))
  const declaredEffects = normalizeDeclaredEffects(input.declaredEffects)
  const effectsByPath = new Map(declaredEffects.map((effect) => [effect.path, effect]))

  const candidateFiles: string[] = []
  const temporaryFiles: string[] = []
  const unexpectedFiles: string[] = []
  const unclassifiedFiles: string[] = []

  for (const dirtyFile of producedByFinalTesting) {
    const effect = effectsByPath.get(dirtyFile.path)
    if (!effect) {
      unclassifiedFiles.push(dirtyFile.path)
      continue
    }
    if (effect.intent === 'candidate') candidateFiles.push(dirtyFile.path)
    if (effect.intent === 'temporary') temporaryFiles.push(dirtyFile.path)
    if (effect.intent === 'unexpected') unexpectedFiles.push(dirtyFile.path)
  }

  const decisionRequiredFiles = uniqueNormalizedPaths(unclassifiedFiles)
  const status = decisionRequiredFiles.length > 0 ? 'blocked' : 'passed'

  return {
    status,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    baselineDirtyFiles: input.baselineDirtyFiles,
    dirtyFilesAfterTesting: input.dirtyFilesAfterTesting,
    producedByFinalTesting,
    declaredEffects,
    candidateFiles: uniqueNormalizedPaths(candidateFiles),
    temporaryFiles: uniqueNormalizedPaths(temporaryFiles),
    unexpectedFiles: uniqueNormalizedPaths(unexpectedFiles),
    unclassifiedFiles: uniqueNormalizedPaths(unclassifiedFiles),
    decisionRequiredFiles,
    message: status === 'passed'
      ? 'Final-test file effects were fully classified.'
      : `Final testing left unclassified dirty file(s): ${decisionRequiredFiles.join(', ')}`,
  }
}

function parseJsonArtifact<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isFinalTestFileEffectsAudit(value: unknown): value is FinalTestFileEffectsAudit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    (record.status === 'passed' || record.status === 'blocked')
    && Array.isArray(record.baselineDirtyFiles)
    && Array.isArray(record.dirtyFilesAfterTesting)
    && Array.isArray(record.producedByFinalTesting)
    && Array.isArray(record.declaredEffects)
    && isStringArray(record.candidateFiles)
    && isStringArray(record.temporaryFiles)
    && isStringArray(record.unexpectedFiles)
    && isStringArray(record.unclassifiedFiles)
    && isStringArray(record.decisionRequiredFiles)
  )
}

function isFinalTestFileEffectsOverride(value: unknown): value is FinalTestFileEffectsOverride {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    (record.decision === 'include_unclassified_as_candidate' || record.decision === 'discard_unclassified')
    && isStringArray(record.files)
    && record.source === 'user'
  )
}

export function readLatestFinalTestFileEffectsAudit(ticketId: string): FinalTestFileEffectsAudit | null {
  const artifact = getLatestPhaseArtifact(ticketId, FINAL_TEST_FILE_EFFECTS_AUDIT_ARTIFACT, 'RUNNING_FINAL_TEST')
  const parsed = artifact ? parseJsonArtifact<FinalTestFileEffectsAudit>(artifact.content) : null
  return isFinalTestFileEffectsAudit(parsed) ? parsed : null
}

export function readLatestFinalTestFileEffectsOverride(ticketId: string): FinalTestFileEffectsOverride | null {
  const artifact = getLatestPhaseArtifact(ticketId, FINAL_TEST_FILE_EFFECTS_OVERRIDE_ARTIFACT)
  const parsed = artifact ? parseJsonArtifact<FinalTestFileEffectsOverride>(artifact.content) : null
  return isFinalTestFileEffectsOverride(parsed) ? parsed : null
}

export function writeFinalTestFileEffectsOverride(
  ticketId: string,
  decision: FinalTestFileEffectsOverride['decision'],
  files: string[],
  phase: 'GENERATING_QA_CHECKLIST' | 'INTEGRATING_CHANGES' = 'INTEGRATING_CHANGES',
): FinalTestFileEffectsOverride {
  const override: FinalTestFileEffectsOverride = {
    decision,
    files: uniqueNormalizedPaths(files),
    createdAt: new Date().toISOString(),
    source: 'user',
  }
  insertPhaseArtifact(ticketId, {
    phase,
    artifactType: FINAL_TEST_FILE_EFFECTS_OVERRIDE_ARTIFACT,
    content: JSON.stringify(override),
  })
  return override
}

export function resolveFinalTestCandidateFiles(ticketId: string): FinalTestCandidateResolution {
  const audit = readLatestFinalTestFileEffectsAudit(ticketId)
  if (!audit) {
    return { ok: true, candidateFiles: [] }
  }

  const override = readLatestFinalTestFileEffectsOverride(ticketId) ?? undefined
  if (audit.status === 'blocked' && !override) {
    return {
      ok: false,
      candidateFiles: [],
      audit,
      errorCode: FINAL_TEST_FILE_EFFECTS_ERROR_CODE,
      message: audit.message,
    }
  }

  const overrideFiles = override?.decision === 'include_unclassified_as_candidate'
    ? override.files
    : []

  return {
    ok: true,
    candidateFiles: uniqueNormalizedPaths([
      ...audit.candidateFiles,
      ...overrideFiles,
    ]),
    audit,
    override,
  }
}

export function discardFinalTestProducedFiles(
  worktreePath: string,
  audit: FinalTestFileEffectsAudit,
  files: string[],
): void {
  const allowedFiles = new Set(audit.decisionRequiredFiles)
  const producedByPath = new Map(audit.producedByFinalTesting.map((file) => [file.path, file]))
  const filesToDiscard = uniqueNormalizedPaths(files)
    .filter((file) => allowedFiles.has(file) && producedByPath.has(file))
  if (filesToDiscard.length === 0) return

  const trackedFiles = filesToDiscard.filter((file) => !producedByPath.get(file)?.untracked)
  const untrackedFiles = filesToDiscard.filter((file) => producedByPath.get(file)?.untracked)

  if (trackedFiles.length > 0) {
    const result = spawnSync('git', [
      '-C',
      worktreePath,
      'restore',
      '--staged',
      '--worktree',
      '--',
      ...trackedFiles.map(toLiteralPathspec),
    ], { encoding: 'utf8' })
    if (result.status !== 0 || result.error) {
      const detail = result.error?.message ?? ((result.stderr ?? '').trim() || `exit code ${result.status ?? '?'}`)
      throw new Error(`Failed to restore final-test file(s): ${detail}`)
    }
  }

  if (untrackedFiles.length > 0) {
    const result = spawnSync('git', [
      '-C',
      worktreePath,
      'clean',
      '-fd',
      '--',
      ...untrackedFiles.map(toLiteralPathspec),
    ], { encoding: 'utf8' })
    if (result.status !== 0 || result.error) {
      const detail = result.error?.message ?? ((result.stderr ?? '').trim() || `exit code ${result.status ?? '?'}`)
      throw new Error(`Failed to remove final-test file(s): ${detail}`)
    }
  }
}
