import { spawnSync } from 'node:child_process'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getErrorMessage } from '../shared/typeGuards'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(__dirname, '..')
export const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageJsonPath = resolve(repoRoot, 'package.json')
const packageLockPath = resolve(repoRoot, 'package-lock.json')
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const installStamp = resolve(repoRoot, 'node_modules', '.package-lock.json')
const npmInstallFlags = ['--no-fund', '--no-audit']
const requiredDevBins = ['tsx', 'vite', 'vitepress', 'concurrently']
export const devPreflightReportPath = resolve(repoRoot, 'tmp', 'dev-preflight-report.json')
export const devMaintenanceStatePath = resolve(repoRoot, 'tmp', 'dev-maintenance-state.json')
const DAILY_MAINTENANCE_STATE_VERSION = 1
const DEPENDENCY_RELEASE_DELAY_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000
const OPENCODE_IMMEDIATE_NPM_PACKAGES = new Set(['@opencode-ai/sdk'])

const KNOWN_AUDIT_LEFTOVERS: Record<string, { note: string; url: string }> = {
  'drizzle-kit': {
    note: 'Stable drizzle-kit still depends on deprecated @esbuild-kit/*; the upstream fix is only available in the beta line.',
    url: 'https://github.com/drizzle-team/drizzle-orm/issues/3067',
  },
  vitepress: {
    note: 'Stable VitePress still ships its own older Vite line, so this remains until an upstream stable release lands.',
    url: 'https://github.com/advisories/GHSA-p9ff-h696-f583',
  },
  mermaid: {
    note: 'Stable Mermaid still pulls uuid <14; the published advisory targets v3/v5/v6 buffer writes and is treated here as a stable-upstream leftover.',
    url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq',
  },
}

export interface InstallReport {
  ran: boolean
  reasons: string[]
  isForced: boolean
  errors: string[]
}

export interface DependencySyncReport {
  skipped: boolean
  deferred: boolean
  checked: boolean
  alreadyCurrent: boolean
  isForced: boolean
  errors: string[]
  updatedDependencies: string[]
  updatedDevDependencies: string[]
  heldDependencies: HeldDependencyUpdate[]
  heldDevDependencies: HeldDependencyUpdate[]
  lastCompletedAt?: string
  nextEligibleAt?: string
}

export interface HeldDependencyUpdate {
  name: string
  current?: string
  latest?: string
  nextEligibleAt?: string
  reason: 'metadata-unavailable' | 'missing-version' | 'non-semver-current' | 'no-aged-version'
}

export interface AgedDependencyTargetSelection {
  targetVersion?: string
  targetPublishedAt?: string
  nextEligibleAt?: string
  reason?: HeldDependencyUpdate['reason']
}

export interface AuditTotals {
  info: number
  low: number
  moderate: number
  high: number
  critical: number
  total: number
}

export interface AuditIssue {
  name: string
  severity: keyof AuditTotals
  relatedPackages: string[]
  note?: string
  url?: string
}

export interface AuditRemediationReport {
  skipped: boolean
  deferred: boolean
  didFixRun: boolean
  fixChanged: boolean
  fixHeld: boolean
  heldPackageUpdates: HeldAuditPackageUpdate[]
  unresolved: AuditIssue[]
  totals: AuditTotals
  errors: string[]
  lastCompletedAt?: string
  nextEligibleAt?: string
}

export interface HeldAuditPackageUpdate {
  name: string
  version?: string
  currentVersion?: string
  nextEligibleAt?: string
  reason: 'metadata-unavailable' | 'missing-version' | 'too-new'
}

export interface OpenCodeUpgradeReport {
  skipped: boolean
  deferred: boolean
  available: boolean
  checked: boolean
  upgraded: boolean
  alreadyCurrent: boolean
  method?: string
  versionBefore?: string
  versionAfter?: string
  errors: string[]
  lastCompletedAt?: string
  nextEligibleAt?: string
}

export interface DevPreflightReport {
  generatedAt: string
  install: InstallReport
  dependencySync: DependencySyncReport
  audit: AuditRemediationReport
  opencode: OpenCodeUpgradeReport
}

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface OutdatedEntry {
  current?: string
  wanted?: string
  latest?: string
}

interface StableSemver {
  major: number
  minor: number
  patch: number
}

interface DependencyUpdatePlan {
  name: string
  current: string
  targetVersion: string
  targetPublishedAt?: string
  bypassedAgeGate: boolean
}

export interface LockfilePackageUpdate {
  name: string
  version: string
  currentVersion?: string
}

interface PackageLockEntry {
  version?: unknown
  link?: unknown
}

interface PackageLockSnapshot {
  packages?: Record<string, PackageLockEntry>
}

interface NpmCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export type DailyMaintenanceTaskName = 'dependencySync' | 'audit' | 'opencode'

export interface DailyMaintenanceTaskState {
  lastCompletedAt: string
  lastCompletedDay: string
}

export interface DailyMaintenanceState {
  version: number
  tasks: Partial<Record<DailyMaintenanceTaskName, DailyMaintenanceTaskState>>
}

export interface DailyMaintenanceDecision {
  shouldRun: boolean
  deferred: boolean
  reason: 'forced' | 'never-ran' | 'new-day' | 'invalidated' | 'already-ran-today'
  lastCompletedAt?: string
  nextEligibleAt?: string
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest
}

function pathExists(path: string) {
  try {
    accessSync(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getMtimeMs(path: string) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function readFileIfPresent(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function getMissingBins() {
  return requiredDevBins.filter((name) => {
    const binPath = resolve(repoRoot, 'node_modules', '.bin', `${name}${binExtension}`)
    return !isExecutable(binPath)
  })
}

export function getInstallReasons() {
  const reasons: string[] = []
  const missingBins = getMissingBins()

  if (!pathExists(resolve(repoRoot, 'node_modules'))) {
    reasons.push('node_modules is missing')
  }

  if (!pathExists(installStamp)) {
    reasons.push('the npm install stamp is missing')
  }

  if (missingBins.length > 0) {
    reasons.push(`missing local dev binaries: ${missingBins.join(', ')}`)
  }

  const installStampMtimeMs = getMtimeMs(installStamp)
  if (installStampMtimeMs !== null) {
    for (const manifestPath of [packageJsonPath, packageLockPath]) {
      const manifestMtimeMs = getMtimeMs(manifestPath)
      if (manifestMtimeMs !== null && manifestMtimeMs > installStampMtimeMs) {
        reasons.push(`${basename(manifestPath)} changed after the last npm install`)
      }
    }
  }

  return reasons
}

function trimCommandOutput(raw: string) {
  return raw.trim()
}

function getLocalDayStamp(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getNextLocalDayStart(date: Date) {
  const next = new Date(date)
  next.setHours(24, 0, 0, 0)
  return next
}

function stripAnsi(raw: string) {
  return raw.replace(new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function runCommand(
  args: string[],
  label: string,
  { verbose = false, cwd = repoRoot }: { verbose?: boolean; cwd?: string } = {},
): NpmCommandResult {
  const result = spawnSync(npmCommand, args, {
    cwd,
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (result.error) {
    throw new Error(`Failed to start ${label}: ${result.error.message}`)
  }

  return {
    status: result.status,
    stdout: trimCommandOutput(result.stdout ?? ''),
    stderr: trimCommandOutput(result.stderr ?? ''),
  }
}

function runExternalCommand(
  command: string,
  args: string[],
  _label: string,
  { verbose = false }: { verbose?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (result.error) {
    return {
      missing: 'code' in result.error && result.error.code === 'ENOENT',
      status: result.status,
      stdout: '',
      stderr: '',
      error: result.error,
    }
  }

  return {
    missing: false,
    status: result.status,
    stdout: stripAnsi(trimCommandOutput(result.stdout ?? '')),
    stderr: stripAnsi(trimCommandOutput(result.stderr ?? '')),
    error: null,
  }
}

function runInstallCommand(
  args: string[],
  label: string,
  { verbose = false, allowForceFallback = false }: { verbose?: boolean; allowForceFallback?: boolean } = {},
) {
  const initial = runCommand(args, label, { verbose })
  if (initial.status === 0) {
    return { isForced: false }
  }

  if (!allowForceFallback) {
    const message = initial.stderr || initial.stdout || `${label} failed with code ${initial.status ?? 'unknown'}`
    throw new Error(message)
  }

  console.warn(`[dev-preflight] ${label} failed; retrying with --force.`)
  const forceRetryResult = runCommand([...args, '--force'], `${label} --force`, { verbose })
  if (forceRetryResult.status === 0) {
    return { isForced: true }
  }

  const message = forceRetryResult.stderr || forceRetryResult.stdout || `${label} --force failed with code ${forceRetryResult.status ?? 'unknown'}`
  throw new Error(message)
}

export function readDailyMaintenanceState(): DailyMaintenanceState {
  const parsed = parseJson<DailyMaintenanceState>(readFileIfPresent(devMaintenanceStatePath) ?? '')
  if (!parsed || parsed.version !== DAILY_MAINTENANCE_STATE_VERSION || typeof parsed.tasks !== 'object' || !parsed.tasks) {
    return {
      version: DAILY_MAINTENANCE_STATE_VERSION,
      tasks: {},
    }
  }

  return parsed
}

export function writeDailyMaintenanceState(state: DailyMaintenanceState) {
  mkdirSync(dirname(devMaintenanceStatePath), { recursive: true })
  writeFileSync(devMaintenanceStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function recordDailyMaintenanceSuccess(
  state: DailyMaintenanceState,
  taskName: DailyMaintenanceTaskName,
  now = new Date(),
) {
  state.tasks[taskName] = {
    lastCompletedAt: now.toISOString(),
    lastCompletedDay: getLocalDayStamp(now),
  }
}

export function decideDailyMaintenanceTask(options: {
  taskName: DailyMaintenanceTaskName
  state: DailyMaintenanceState
  force?: boolean
  now?: Date
  invalidatedByPaths?: string[]
}) : DailyMaintenanceDecision {
  const {
    taskName,
    state,
    force = false,
    now = new Date(),
    invalidatedByPaths = [],
  } = options

  const existing = state.tasks[taskName]
  if (force) {
    return {
      shouldRun: true,
      deferred: false,
      reason: 'forced',
      lastCompletedAt: existing?.lastCompletedAt,
    }
  }

  if (!existing?.lastCompletedAt) {
    return {
      shouldRun: true,
      deferred: false,
      reason: 'never-ran',
    }
  }

  const currentDay = getLocalDayStamp(now)
  if (existing.lastCompletedDay !== currentDay) {
    return {
      shouldRun: true,
      deferred: false,
      reason: 'new-day',
      lastCompletedAt: existing.lastCompletedAt,
    }
  }

  const completedAtMs = Date.parse(existing.lastCompletedAt)
  if (Number.isFinite(completedAtMs)) {
    for (const path of invalidatedByPaths) {
      const mtimeMs = getMtimeMs(path)
      if (mtimeMs !== null && mtimeMs > completedAtMs) {
        return {
          shouldRun: true,
          deferred: false,
          reason: 'invalidated',
          lastCompletedAt: existing.lastCompletedAt,
        }
      }
    }
  }

  return {
    shouldRun: false,
    deferred: true,
    reason: 'already-ran-today',
    lastCompletedAt: existing.lastCompletedAt,
    nextEligibleAt: getNextLocalDayStart(now).toISOString(),
  }
}

function emptyTotals(): AuditTotals {
  return {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  }
}

function severityRank(severity: string) {
  switch (severity) {
    case 'critical':
      return 5
    case 'high':
      return 4
    case 'moderate':
      return 3
    case 'low':
      return 2
    case 'info':
      return 1
    default:
      return 0
  }
}

function chooseAuditDisplayName(name: string, effects: string[] | undefined) {
  if (name === '@esbuild-kit/core-utils' || name === '@esbuild-kit/esm-loader') {
    return 'drizzle-kit'
  }

  if (name === 'uuid') {
    return 'mermaid'
  }

  if (name === 'vite') {
    return 'vitepress'
  }

  if (name === 'esbuild' && (effects?.includes('vite') || effects?.includes('vitepress'))) {
    return 'vitepress'
  }

  for (const effect of effects ?? []) {
    if (KNOWN_AUDIT_LEFTOVERS[effect]) {
      return effect
    }
  }

  return KNOWN_AUDIT_LEFTOVERS[name] ? name : (effects?.[0] ?? name)
}

function parseJson<T>(text: string): T | null {
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function parseStableSemver(version: string | undefined): StableSemver | null {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareStableSemver(left: StableSemver, right: StableSemver) {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

function isFiniteTimestamp(timestamp: number) {
  return Number.isFinite(timestamp) && timestamp > 0
}

function toIsoTimestamp(timestamp: number | null) {
  return timestamp == null || !isFiniteTimestamp(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function getPackagePublishTimes(packageName: string) {
  const result = runCommand(['view', packageName, 'time', '--json'], `npm view ${packageName} time`, { verbose: false })
  if (result.status !== 0 || !result.stdout) {
    return {
      times: null,
      error: result.stderr || result.stdout || `npm view ${packageName} time failed with code ${result.status ?? 'unknown'}`,
    }
  }

  const times = parseJson<Record<string, string>>(result.stdout)
  if (!times) {
    return {
      times: null,
      error: result.stderr || result.stdout || `Unable to parse npm publish times for ${packageName}`,
    }
  }

  return { times, error: null }
}

export function chooseAgedDependencyTarget(options: {
  currentVersion?: string
  latestVersion?: string
  publishTimes?: Record<string, string> | null
  now?: Date
  minimumAgeDays?: number
  bypassAgeGate?: boolean
}): AgedDependencyTargetSelection {
  const {
    currentVersion,
    latestVersion,
    publishTimes,
    now = new Date(),
    minimumAgeDays = DEPENDENCY_RELEASE_DELAY_DAYS,
    bypassAgeGate = false,
  } = options

  if (!currentVersion || !latestVersion) {
    return { reason: 'missing-version' }
  }

  if (currentVersion === latestVersion) {
    return { reason: 'no-aged-version' }
  }

  if (bypassAgeGate) {
    return {
      targetVersion: latestVersion,
      targetPublishedAt: publishTimes?.[latestVersion],
    }
  }

  const current = parseStableSemver(currentVersion)
  if (!current) {
    return { reason: 'non-semver-current' }
  }

  if (!publishTimes) {
    return { reason: 'metadata-unavailable' }
  }

  const minimumAgeMs = Math.max(0, minimumAgeDays) * MS_PER_DAY
  const cutoffMs = now.getTime() - minimumAgeMs
  let bestVersion: string | undefined
  let bestParsed: StableSemver | null = null
  let bestPublishedAt: string | undefined
  let nextEligibleAtMs: number | null = null

  for (const [version, publishedAt] of Object.entries(publishTimes)) {
    const parsed = parseStableSemver(version)
    if (!parsed || compareStableSemver(parsed, current) <= 0) {
      continue
    }

    const publishedAtMs = Date.parse(publishedAt)
    if (!isFiniteTimestamp(publishedAtMs)) {
      continue
    }

    if (publishedAtMs <= cutoffMs) {
      if (!bestParsed || compareStableSemver(parsed, bestParsed) > 0) {
        bestVersion = version
        bestParsed = parsed
        bestPublishedAt = publishedAt
      }
      continue
    }

    const eligibleAtMs = publishedAtMs + minimumAgeMs
    if (eligibleAtMs > now.getTime() && (nextEligibleAtMs == null || eligibleAtMs < nextEligibleAtMs)) {
      nextEligibleAtMs = eligibleAtMs
    }
  }

  if (bestVersion) {
    return {
      targetVersion: bestVersion,
      targetPublishedAt: bestPublishedAt,
      nextEligibleAt: toIsoTimestamp(nextEligibleAtMs),
    }
  }

  return {
    reason: 'no-aged-version',
    nextEligibleAt: toIsoTimestamp(nextEligibleAtMs),
  }
}

export function evaluatePackageVersionReleaseAge(options: {
  version?: string
  publishTimes?: Record<string, string> | null
  now?: Date
  minimumAgeDays?: number
  bypassAgeGate?: boolean
}): { eligible: boolean; publishedAt?: string; nextEligibleAt?: string; reason?: HeldAuditPackageUpdate['reason'] } {
  const {
    version,
    publishTimes,
    now = new Date(),
    minimumAgeDays = DEPENDENCY_RELEASE_DELAY_DAYS,
    bypassAgeGate = false,
  } = options

  if (!version) {
    return { eligible: false, reason: 'missing-version' }
  }

  if (bypassAgeGate) {
    return {
      eligible: true,
      publishedAt: publishTimes?.[version],
    }
  }

  if (!publishTimes) {
    return { eligible: false, reason: 'metadata-unavailable' }
  }

  const publishedAt = publishTimes[version]
  const publishedAtMs = Date.parse(publishedAt ?? '')
  if (!publishedAt || !isFiniteTimestamp(publishedAtMs)) {
    return { eligible: false, reason: 'missing-version' }
  }

  const eligibleAtMs = publishedAtMs + Math.max(0, minimumAgeDays) * MS_PER_DAY
  if (eligibleAtMs > now.getTime()) {
    return {
      eligible: false,
      publishedAt,
      nextEligibleAt: toIsoTimestamp(eligibleAtMs),
      reason: 'too-new',
    }
  }

  return {
    eligible: true,
    publishedAt,
  }
}

function getPackageNameFromLockPath(lockPath: string) {
  const marker = 'node_modules/'
  const markerIndex = lockPath.lastIndexOf(marker)
  if (markerIndex < 0) {
    return null
  }

  const packagePath = lockPath.slice(markerIndex + marker.length)
  const parts = packagePath.split('/')
  if (parts[0]?.startsWith('@')) {
    return parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : null
  }

  return parts[0] || null
}

export function collectLockfilePackageUpdates(
  currentLockContents: string,
  proposedLockContents: string,
): { updates: LockfilePackageUpdate[]; errors: string[] } {
  const currentLock = parseJson<PackageLockSnapshot>(currentLockContents)
  const proposedLock = parseJson<PackageLockSnapshot>(proposedLockContents)
  if (!currentLock?.packages || !proposedLock?.packages) {
    return {
      updates: [],
      errors: ['Unable to parse npm audit fix lockfile preview.'],
    }
  }

  const updatesByPackageVersion = new Map<string, LockfilePackageUpdate>()

  for (const [lockPath, proposedEntry] of Object.entries(proposedLock.packages)) {
    if (!lockPath || proposedEntry.link === true || typeof proposedEntry.version !== 'string') {
      continue
    }

    const name = getPackageNameFromLockPath(lockPath)
    if (!name) {
      continue
    }

    const currentEntry = currentLock.packages[lockPath]
    const currentVersion = typeof currentEntry?.version === 'string' ? currentEntry.version : undefined
    if (currentVersion === proposedEntry.version) {
      continue
    }

    const key = `${name}@${proposedEntry.version}`
    if (!updatesByPackageVersion.has(key)) {
      updatesByPackageVersion.set(key, {
        name,
        version: proposedEntry.version,
        currentVersion,
      })
    }
  }

  return {
    updates: [...updatesByPackageVersion.values()].sort((left, right) => {
      const nameDelta = left.name.localeCompare(right.name)
      return nameDelta !== 0 ? nameDelta : left.version.localeCompare(right.version)
    }),
    errors: [],
  }
}

function findHeldAuditPackageUpdates(updates: LockfilePackageUpdate[], { now = new Date(), verbose = false }: { now?: Date; verbose?: boolean } = {}) {
  const held: HeldAuditPackageUpdate[] = []

  for (const update of updates) {
    const bypassAgeGate = OPENCODE_IMMEDIATE_NPM_PACKAGES.has(update.name)
    const publishTimesResult = bypassAgeGate
      ? { times: null as Record<string, string> | null, error: null as string | null }
      : getPackagePublishTimes(update.name)

    if (!bypassAgeGate && publishTimesResult.error) {
      if (verbose) {
        console.warn(`[dev-preflight] Holding npm audit fix; unable to verify ${update.name}@${update.version}: ${publishTimesResult.error}`)
      }
      held.push({
        name: update.name,
        version: update.version,
        currentVersion: update.currentVersion,
        reason: 'metadata-unavailable',
      })
      continue
    }

    const releaseAge = evaluatePackageVersionReleaseAge({
      version: update.version,
      publishTimes: publishTimesResult.times,
      now,
      bypassAgeGate,
    })

    if (!releaseAge.eligible) {
      held.push({
        name: update.name,
        version: update.version,
        currentVersion: update.currentVersion,
        nextEligibleAt: releaseAge.nextEligibleAt,
        reason: releaseAge.reason ?? 'too-new',
      })
    }
  }

  return held
}

function previewAuditFixLockfile({ verbose = false }: { verbose?: boolean } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'looptroop-audit-fix-'))
  const tempPackageJsonPath = resolve(tempDir, 'package.json')
  const tempPackageLockPath = resolve(tempDir, 'package-lock.json')

  try {
    copyFileSync(packageJsonPath, tempPackageJsonPath)
    copyFileSync(packageLockPath, tempPackageLockPath)
    runCommand(
      ['audit', 'fix', '--package-lock-only', '--ignore-scripts'],
      'npm audit fix --package-lock-only',
      { verbose, cwd: tempDir },
    )

    return {
      lockContents: readFileIfPresent(tempPackageLockPath),
      error: null as string | null,
    }
  } catch (error) {
    return {
      lockContents: null,
      error: getErrorMessage(error),
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function summarizeAuditIssues(vulnerabilities: Record<string, {
  name: string
  severity: keyof AuditTotals
  effects?: string[]
}> | undefined): AuditIssue[] {
  const issues = new Map<string, AuditIssue>()

  for (const [name, vulnerability] of Object.entries(vulnerabilities ?? {})) {
    const displayName = chooseAuditDisplayName(name, vulnerability.effects)
    const known = KNOWN_AUDIT_LEFTOVERS[displayName] ?? KNOWN_AUDIT_LEFTOVERS[name]
    const existing = issues.get(displayName)

    if (!existing) {
      issues.set(displayName, {
        name: displayName,
        severity: vulnerability.severity,
        relatedPackages: [name],
        note: known?.note,
        url: known?.url,
      })
      continue
    }

    if (severityRank(vulnerability.severity) > severityRank(existing.severity)) {
      existing.severity = vulnerability.severity
    }

    if (!existing.relatedPackages.includes(name)) {
      existing.relatedPackages.push(name)
    }
  }

  return [...issues.values()].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity)
    return severityDelta !== 0 ? severityDelta : left.name.localeCompare(right.name)
  })
}

export function ensureInstallIfNeeded(
  { verbose = false, allowForceFallback = false }: { verbose?: boolean; allowForceFallback?: boolean } = {},
): InstallReport {
  const reasons = getInstallReasons()
  if (reasons.length === 0) {
    return {
      ran: false,
      reasons: [],
      isForced: false,
      errors: [],
    }
  }

  const installCommand = allowForceFallback ? 'install' : 'ci'
  console.log(`[dev-preflight] Running npm ${installCommand} before starting dev:`)
  for (const reason of reasons) {
    console.log(`[dev-preflight] - ${reason}`)
  }

  try {
    const result = runInstallCommand([installCommand, ...npmInstallFlags], `npm ${installCommand}`, {
      verbose,
      allowForceFallback,
    })

    return {
      ran: true,
      reasons,
      isForced: result.isForced,
      errors: [],
    }
  } catch (error) {
    return {
      ran: true,
      reasons,
      isForced: false,
      errors: [getErrorMessage(error)],
    }
  }
}

function planDependencyUpdates(
  outdated: Record<string, OutdatedEntry>,
  manifestDependencies: Record<string, string> | undefined,
  { now = new Date(), verbose = false }: { now?: Date; verbose?: boolean } = {},
) {
  const updates: DependencyUpdatePlan[] = []
  const held: HeldDependencyUpdate[] = []

  for (const [name, entry] of Object.entries(outdated)) {
    if (manifestDependencies?.[name] == null) {
      continue
    }

    const bypassAgeGate = OPENCODE_IMMEDIATE_NPM_PACKAGES.has(name)
    const publishTimesResult = bypassAgeGate
      ? { times: null as Record<string, string> | null, error: null as string | null }
      : getPackagePublishTimes(name)

    if (!bypassAgeGate && publishTimesResult.error) {
      if (verbose) {
        console.warn(`[dev-preflight] Holding ${name}; unable to verify npm publish times: ${publishTimesResult.error}`)
      }
      held.push({
        name,
        current: entry.current,
        latest: entry.latest,
        reason: 'metadata-unavailable',
      })
      continue
    }

    const selection = chooseAgedDependencyTarget({
      currentVersion: entry.current,
      latestVersion: entry.latest,
      publishTimes: publishTimesResult.times,
      now,
      bypassAgeGate,
    })

    if (selection.targetVersion && entry.current) {
      updates.push({
        name,
        current: entry.current,
        targetVersion: selection.targetVersion,
        targetPublishedAt: selection.targetPublishedAt,
        bypassedAgeGate: bypassAgeGate,
      })
      continue
    }

    held.push({
      name,
      current: entry.current,
      latest: entry.latest,
      nextEligibleAt: selection.nextEligibleAt,
      reason: selection.reason ?? 'no-aged-version',
    })
  }

  return { updates, held }
}

function formatDependencyUpdateSpecs(updates: DependencyUpdatePlan[]) {
  return updates.map((update) => `${update.name}@${update.targetVersion}`)
}

export function syncDirectDependencies(
  { verbose = false, skip = false }: { verbose?: boolean; skip?: boolean } = {},
): DependencySyncReport {
  if (skip) {
    return {
      skipped: true,
      deferred: false,
      checked: false,
      alreadyCurrent: false,
      isForced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
      heldDependencies: [],
      heldDevDependencies: [],
    }
  }

  const outdatedResult = runCommand(['outdated', '--json', '--long'], 'npm outdated', { verbose: false })
  if (!outdatedResult.stdout) {
    return {
      skipped: false,
      deferred: false,
      checked: true,
      alreadyCurrent: true,
      isForced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
      heldDependencies: [],
      heldDevDependencies: [],
    }
  }

  const outdated = parseJson<Record<string, OutdatedEntry>>(outdatedResult.stdout)
  if (!outdated) {
    const message = outdatedResult.stderr || outdatedResult.stdout
    return {
      skipped: false,
      deferred: false,
      checked: false,
      alreadyCurrent: false,
      isForced: false,
      errors: message ? [`Unable to parse npm outdated output: ${message}`] : [],
      updatedDependencies: [],
      updatedDevDependencies: [],
      heldDependencies: [],
      heldDevDependencies: [],
    }
  }

  const manifest = readPackageManifest()
  const runtimePlan = planDependencyUpdates(outdated, manifest.dependencies, { verbose })
  const devPlan = planDependencyUpdates(outdated, manifest.devDependencies, { verbose })
  const updatedDependencies = runtimePlan.updates.map((update) => update.name)
  const updatedDevDependencies = devPlan.updates.map((update) => update.name)
  const heldDependencies = runtimePlan.held
  const heldDevDependencies = devPlan.held

  if (
    updatedDependencies.length === 0 &&
    updatedDevDependencies.length === 0 &&
    heldDependencies.length === 0 &&
    heldDevDependencies.length === 0
  ) {
    return {
      skipped: false,
      deferred: false,
      checked: true,
      alreadyCurrent: true,
      isForced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
      heldDependencies: [],
      heldDevDependencies: [],
    }
  }

  let isForced = false
  const errors: string[] = []

  try {
    if (updatedDependencies.length > 0) {
      console.log(
        `[dev-preflight] Updating ${updatedDependencies.length} direct runtime ` +
        `${updatedDependencies.length === 1 ? 'dependency' : 'dependencies'} to eligible stable releases.`,
      )
      const result = runInstallCommand(
        ['install', ...npmInstallFlags, ...formatDependencyUpdateSpecs(runtimePlan.updates)],
        'npm install <dependencies>@<aged-version>',
        { verbose, allowForceFallback: true },
      )
      isForced = isForced || result.isForced
    }

    if (updatedDevDependencies.length > 0) {
      console.log(
        `[dev-preflight] Updating ${updatedDevDependencies.length} direct dev ` +
        `${updatedDevDependencies.length === 1 ? 'dependency' : 'dependencies'} to eligible stable releases.`,
      )
      const result = runInstallCommand(
        ['install', ...npmInstallFlags, '-D', ...formatDependencyUpdateSpecs(devPlan.updates)],
        'npm install -D <dependencies>@<aged-version>',
        { verbose, allowForceFallback: true },
      )
      isForced = isForced || result.isForced
    }
  } catch (error) {
    errors.push(getErrorMessage(error))
  }

  return {
    skipped: false,
    deferred: false,
    checked: true,
    alreadyCurrent: false,
    isForced,
    errors,
    updatedDependencies,
    updatedDevDependencies,
    heldDependencies,
    heldDevDependencies,
  }
}

export function remediateAudit(
  { verbose = false, skip = false }: { verbose?: boolean; skip?: boolean } = {},
): AuditRemediationReport {
  if (skip) {
    return {
      skipped: true,
      deferred: false,
      didFixRun: false,
      fixChanged: false,
      fixHeld: false,
      heldPackageUpdates: [],
      unresolved: [],
      totals: emptyTotals(),
      errors: [],
    }
  }

  const lockContentsBefore = readFileIfPresent(packageLockPath)
  const errors: string[] = []
  const heldPackageUpdates: HeldAuditPackageUpdate[] = []
  let didFixRun = false
  let fixHeld = false

  if (!lockContentsBefore) {
    errors.push('Unable to read package-lock.json before npm audit remediation.')
  } else {
    const preview = previewAuditFixLockfile({ verbose })

    if (preview.error) {
      errors.push(`Unable to preview npm audit fix: ${preview.error}`)
    } else if (!preview.lockContents) {
      errors.push('Unable to read npm audit fix lockfile preview.')
    } else {
      const lockfileUpdates = collectLockfilePackageUpdates(lockContentsBefore, preview.lockContents)
      errors.push(...lockfileUpdates.errors)

      if (lockfileUpdates.errors.length === 0) {
        heldPackageUpdates.push(...findHeldAuditPackageUpdates(lockfileUpdates.updates, { verbose }))
        fixHeld = heldPackageUpdates.length > 0

        if (!fixHeld) {
          try {
            didFixRun = true
            runCommand(['audit', 'fix'], 'npm audit fix', { verbose })
          } catch (error) {
            errors.push(getErrorMessage(error))
          }
        }
      }
    }
  }

  const lockContentsAfter = readFileIfPresent(packageLockPath)
  const fixChanged = lockContentsBefore !== lockContentsAfter

  const auditResult = runCommand(['audit', '--json'], 'npm audit --json', { verbose: false })
  const auditJson = parseJson<{
    vulnerabilities?: Record<string, {
      name: string
      severity: keyof AuditTotals
      effects?: string[]
    }>
    metadata?: {
      vulnerabilities?: AuditTotals
    }
  }>(auditResult.stdout)

  if (!auditJson) {
    const message = auditResult.stderr || auditResult.stdout
    if (message) {
      errors.push(`Unable to parse npm audit output: ${message}`)
    }
  }

  return {
    skipped: false,
    deferred: false,
    didFixRun,
    fixChanged,
    fixHeld,
    heldPackageUpdates,
    unresolved: summarizeAuditIssues(auditJson?.vulnerabilities),
    totals: auditJson?.metadata?.vulnerabilities ?? emptyTotals(),
    errors,
  }
}

function getOpenCodeVersion() {
  const result = runExternalCommand('opencode', ['--version'], 'opencode --version')
  if (result.missing) {
    return { available: false as const, version: null }
  }

  if (result.error) {
    throw new Error(`Failed to start opencode --version: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `opencode --version failed with code ${result.status ?? 'unknown'}`
    throw new Error(message)
  }

  const version = (result.stdout || result.stderr).trim() || null
  return { available: true as const, version }
}

export function upgradeOpenCodeCli(
  { verbose = false, skip = false, logPrefix = 'dev-preflight' }: { verbose?: boolean; skip?: boolean; logPrefix?: string } = {},
): OpenCodeUpgradeReport {
  if (skip) {
    return {
      skipped: true,
      deferred: false,
      available: false,
      checked: false,
      upgraded: false,
      alreadyCurrent: false,
      errors: [],
    }
  }

  let versionBefore: string | undefined
  let versionAfter: string | undefined

  try {
    const before = getOpenCodeVersion()
    if (!before.available) {
      return {
        skipped: false,
        deferred: false,
        available: false,
        checked: false,
        upgraded: false,
        alreadyCurrent: false,
        errors: [],
      }
    }

    versionBefore = before.version ?? undefined
    if (logPrefix) {
      console.log(`[${logPrefix}] Checking OpenCode CLI for updates.`)
    }

    const result = runExternalCommand('opencode', ['upgrade'], 'opencode upgrade', { verbose })
    if (result.missing) {
      return {
        skipped: false,
        deferred: false,
        available: false,
        checked: false,
        upgraded: false,
        alreadyCurrent: false,
        versionBefore,
        errors: [],
      }
    }

    if (result.error) {
      throw new Error(`Failed to start opencode upgrade: ${result.error.message}`)
    }

    if (result.status !== 0) {
      const message = result.stderr || result.stdout || `opencode upgrade failed with code ${result.status ?? 'unknown'}`
      return {
        skipped: false,
        deferred: false,
        available: true,
        checked: true,
        upgraded: false,
        alreadyCurrent: false,
        versionBefore,
        errors: [message],
      }
    }

    const after = getOpenCodeVersion()
    versionAfter = after.version ?? undefined

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    const method = output.match(/Using method:\s*(.+)/i)?.[1]?.trim()
    const alreadyCurrent = /upgrade skipped:/i.test(output) ||
      (Boolean(versionBefore) && Boolean(versionAfter) && versionBefore === versionAfter)
    const upgraded = Boolean(versionBefore && versionAfter && versionBefore !== versionAfter)

    return {
      skipped: false,
      deferred: false,
      available: true,
      checked: true,
      upgraded,
      alreadyCurrent,
      method,
      versionBefore,
      versionAfter,
      errors: [],
    }
  } catch (error) {
    return {
      skipped: false,
      deferred: false,
      available: true,
      checked: false,
      upgraded: false,
      alreadyCurrent: false,
      versionBefore,
      versionAfter,
      errors: [getErrorMessage(error)],
    }
  }
}

export function writeDevPreflightReport(report: DevPreflightReport) {
  mkdirSync(dirname(devPreflightReportPath), { recursive: true })
  writeFileSync(devPreflightReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export function readDevPreflightReport(): DevPreflightReport | null {
  if (!existsSync(devPreflightReportPath)) {
    return null
  }

  return parseJson<DevPreflightReport>(readFileSync(devPreflightReportPath, 'utf8'))
}
