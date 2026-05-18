import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBackendPort, getDocsPort, getFrontendPort } from '../shared/appConfig'
import {
  decideDailyMaintenanceTask,
  ensureInstallIfNeeded,
  getMissingBins,
  readDailyMaintenanceState,
  recordDailyMaintenanceSuccess,
  remediateAudit,
  syncDirectDependencies,
  upgradeOpenCodeCli,
  writeDailyMaintenanceState,
  writeDevPreflightReport,
} from './dev-maintenance'
import {
  buildProcessGraph,
  collectProcessTree,
  formatProcessSummary,
  isLoopTroopDevProcess,
  findOwningRootProcess,
  parseProcessTable,
  resolveProcessTreesToTerminate,
  type ProcessInfo,
} from './dev-preflight-utils'
import {
  describePortOccupants,
  formatPortOccupantSummary,
  inspectPortOccupants,
} from './port-occupants'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const packageJsonPath = resolve(repoRoot, 'package.json')
const packageLockPath = resolve(repoRoot, 'package-lock.json')
const isVerboseLogging = process.env.LOOPTROOP_DEV_VERBOSE === '1'
const shouldSkipDependencyMaintenance = process.env.LOOPTROOP_DEV_SKIP_DEPS === '1'
const shouldSkipOpenCodeUpgrade = process.env.LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE === '1'
const shouldForceDailyMaintenance = process.env.LOOPTROOP_DEV_FORCE_MAINTENANCE === '1'

const configuredPorts = [
  { label: 'frontend', port: getFrontendPort() },
  { label: 'backend', port: getBackendPort() },
  { label: 'docs', port: getDocsPort() },
]

function listProcesses() {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    return parseProcessTable(output)
  } catch (error) {
    if (isVerboseLogging) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[dev-preflight] Process table inspection is unavailable on this platform: ${message}`)
    }
    return []
  }
}

function collectProtectedPids(currentPid: number, graph: ReturnType<typeof buildProcessGraph>) {
  const protectedPids = new Set<number>()
  let current = graph.byPid.get(currentPid)

  while (current) {
    protectedPids.add(current.pid)
    current = graph.byPid.get(current.ppid)
  }

  return protectedPids
}

function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM') {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function sleep(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function ensurePortFree(port: number) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const server = net.createServer()
    server.once('error', (error) => {
      server.close()
      rejectPromise(error)
    })
    server.listen(port, '127.0.0.1', () => {
      server.close((closeError) => {
        if (closeError) {
          rejectPromise(closeError)
          return
        }
        resolvePromise()
      })
    })
  })
}

async function terminateProcessTree(root: ProcessInfo, graph = buildProcessGraph(listProcesses())) {
  const processTree = collectProcessTree(root.pid, graph)
  console.log(
    `[dev-preflight] Stopping stale LoopTroop dev tree rooted at ${formatProcessSummary(root)}` +
    ` (${processTree.length} ${processTree.length === 1 ? 'process' : 'processes'}).`,
  )
  if (isVerboseLogging) {
    console.log(`[dev-preflight]   tree: ${processTree.map(formatProcessSummary).join(' | ')}`)
  }

  for (const entry of processTree) {
    killProcess(entry.pid)
  }

  await sleep(300)

  const survivors = processTree.filter((entry) => isProcessAlive(entry.pid))
  if (survivors.length > 0) {
    console.warn(
      `[dev-preflight] Escalating to SIGKILL for ${survivors.length} stubborn ` +
      `${survivors.length === 1 ? 'process' : 'processes'} in the stale dev tree.`,
    )
    if (isVerboseLogging) {
      console.warn(`[dev-preflight]   survivors: ${survivors.map(formatProcessSummary).join(' | ')}`)
    }
    for (const entry of survivors) {
      killProcess(entry.pid, 'SIGKILL')
    }
    await sleep(300)
  }
}

async function reclaimOccupiedPorts(ports: number[]) {
  const processes = listProcesses()
  const graph = buildProcessGraph(processes)
  const protectedPids = collectProtectedPids(process.pid, graph)

  const initialRoots = new Map<number, ProcessInfo>()
  const unresolvedOccupants: Array<{ port: number; summary: string }> = []

  for (const port of ports) {
    const inspection = inspectPortOccupants(port, { includeFallbackSnapshot: isVerboseLogging })
    const occupantPids = inspection.occupants
      .map((occupant) => occupant.pid)
      .filter((pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    const resolution = resolveProcessTreesToTerminate(processes, occupantPids, repoRoot)
    for (const root of resolution.roots) {
      if (protectedPids.has(root.pid)) continue
      initialRoots.set(root.pid, root)
    }
    for (const occupant of resolution.unrelatedOccupants) {
      const knownOccupant = inspection.occupants.find((entry) => entry.pid === occupant.pid)
      unresolvedOccupants.push({
        port,
        summary: formatPortOccupantSummary(
          knownOccupant ?? { pid: occupant.pid, command: occupant.args },
        ) ?? formatProcessSummary(occupant),
      })
    }
  }

  if (unresolvedOccupants.length > 0) {
    for (const occupant of unresolvedOccupants) {
      console.error(
        `[dev-preflight] Refusing to terminate unrelated occupant on port ${occupant.port}: ${occupant.summary}`,
      )
    }
    return false
  }

  for (const root of initialRoots.values()) {
    await terminateProcessTree(root, graph)
  }

  await sleep(500)
  return true
}

function ensureDistinctConfiguredPorts() {
  const labelsByPort = new Map<number, string[]>()

  for (const { label, port } of configuredPorts) {
    const labels = labelsByPort.get(port) ?? []
    labels.push(label)
    labelsByPort.set(port, labels)
  }

  let hasConflict = false
  for (const [port, labels] of labelsByPort) {
    if (labels.length < 2) continue
    hasConflict = true
    console.error(
      `[dev-preflight] Port configuration conflict: ${labels.join(', ')} all use ${port}. ` +
      'Set LOOPTROOP_FRONTEND_PORT, LOOPTROOP_BACKEND_PORT, and LOOPTROOP_DOCS_PORT to distinct values.',
    )
  }

  if (hasConflict) {
    process.exit(1)
  }
}

ensureDistinctConfiguredPorts()
const maintenanceState = readDailyMaintenanceState()

const installReport = ensureInstallIfNeeded({ verbose: isVerboseLogging })
for (const error of installReport.errors) {
  console.error(`[dev-preflight] ${error}`)
}
if (installReport.errors.length > 0) {
  process.exit(1)
}

const dependencySyncDecision = decideDailyMaintenanceTask({
  taskName: 'dependencySync',
  state: maintenanceState,
  force: shouldForceDailyMaintenance,
  invalidatedByPaths: [packageJsonPath],
})

const dependencySyncReport = shouldSkipDependencyMaintenance
  ? syncDirectDependencies({
    verbose: isVerboseLogging,
    skip: true,
  })
  : dependencySyncDecision.shouldRun
    ? syncDirectDependencies({
      verbose: isVerboseLogging,
      skip: false,
    })
    : {
      skipped: false,
      deferred: true,
      checked: false,
      alreadyCurrent: false,
      isForced: false,
      errors: [],
      updatedDependencies: [],
      updatedDevDependencies: [],
      heldDependencies: [],
      heldDevDependencies: [],
      lastCompletedAt: dependencySyncDecision.lastCompletedAt,
      nextEligibleAt: dependencySyncDecision.nextEligibleAt,
    }

for (const error of dependencySyncReport.errors) {
  console.error(`[dev-preflight] ${error}`)
}
if (dependencySyncReport.errors.length > 0) {
  process.exit(1)
}
if (!shouldSkipDependencyMaintenance && dependencySyncDecision.shouldRun && dependencySyncReport.checked && dependencySyncReport.errors.length === 0) {
  recordDailyMaintenanceSuccess(maintenanceState, 'dependencySync')
}

const auditDecision = decideDailyMaintenanceTask({
  taskName: 'audit',
  state: maintenanceState,
  force: shouldForceDailyMaintenance,
  invalidatedByPaths: [packageJsonPath, packageLockPath],
})

const auditReport = shouldSkipDependencyMaintenance
  ? remediateAudit({
    verbose: isVerboseLogging,
    skip: true,
  })
  : auditDecision.shouldRun
    ? remediateAudit({
      verbose: isVerboseLogging,
      skip: false,
    })
    : {
      skipped: false,
      deferred: true,
      didFixRun: false,
      fixChanged: false,
      fixHeld: false,
      heldPackageUpdates: [],
      unresolved: [],
      totals: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
      errors: [],
      lastCompletedAt: auditDecision.lastCompletedAt,
      nextEligibleAt: auditDecision.nextEligibleAt,
    }

for (const error of auditReport.errors) {
  console.error(`[dev-preflight] ${error}`)
}
if (auditReport.errors.length > 0) {
  process.exit(1)
}
if (!shouldSkipDependencyMaintenance && auditDecision.shouldRun && auditReport.errors.length === 0) {
  recordDailyMaintenanceSuccess(maintenanceState, 'audit')
}

const opencodeDecision = decideDailyMaintenanceTask({
  taskName: 'opencode',
  state: maintenanceState,
  force: shouldForceDailyMaintenance,
})

const opencodeReport = shouldSkipOpenCodeUpgrade
  ? upgradeOpenCodeCli({
    verbose: isVerboseLogging,
    skip: true,
    logPrefix: isVerboseLogging ? 'dev-preflight' : '',
  })
  : opencodeDecision.shouldRun
    ? upgradeOpenCodeCli({
      verbose: isVerboseLogging,
      skip: false,
      logPrefix: isVerboseLogging ? 'dev-preflight' : '',
    })
    : {
      skipped: false,
      deferred: true,
      available: true,
      checked: false,
      upgraded: false,
      alreadyCurrent: false,
      errors: [],
      lastCompletedAt: opencodeDecision.lastCompletedAt,
      nextEligibleAt: opencodeDecision.nextEligibleAt,
    }

for (const error of opencodeReport.errors) {
  console.error(`[dev-preflight] ${error}`)
}
if (opencodeReport.errors.length > 0) {
  process.exit(1)
}
if (!shouldSkipOpenCodeUpgrade && opencodeDecision.shouldRun && opencodeReport.errors.length === 0 && opencodeReport.available) {
  recordDailyMaintenanceSuccess(maintenanceState, 'opencode')
}

writeDailyMaintenanceState(maintenanceState)

const missingBinsAfterMaintenance = getMissingBins()
if (missingBinsAfterMaintenance.length > 0) {
  console.error(
    '[dev-preflight] Required dev tools are missing after dependency install checks: ' +
    missingBinsAfterMaintenance.join(', '),
  )
  process.exit(1)
}

const processes = listProcesses()
const graph = buildProcessGraph(processes)
const protectedPids = collectProtectedPids(process.pid, graph)
const staleRoots = new Map<number, ProcessInfo>()
for (const processEntry of processes) {
  if (processEntry.pid === process.pid) continue
  if (!isLoopTroopDevProcess(processEntry.args, repoRoot)) continue
  const root = findOwningRootProcess(processEntry, graph, repoRoot)
  if (root && !protectedPids.has(root.pid)) {
    staleRoots.set(root.pid, root)
  }
}

for (const root of staleRoots.values()) {
  await terminateProcessTree(root, graph)
}

if (staleRoots.size > 0) {
  await sleep(500)
}

const reclaimed = await reclaimOccupiedPorts(configuredPorts.map(({ port }) => port))
if (!reclaimed) {
  process.exit(1)
}

for (const { label, port } of configuredPorts) {
  try {
    await ensurePortFree(port)
  } catch (error) {
    const inspection = inspectPortOccupants(port)
    const occupantPids = inspection.occupants
      .map((occupant) => occupant.pid)
      .filter((pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    const remainingProcesses = listProcesses()
    const resolution = resolveProcessTreesToTerminate(remainingProcesses, occupantPids, repoRoot)
    if (resolution.roots.length > 0) {
      const graph = buildProcessGraph(remainingProcesses)
      const protectedPids = collectProtectedPids(process.pid, graph)
      for (const root of resolution.roots) {
        if (protectedPids.has(root.pid)) continue
        await terminateProcessTree(root, graph)
      }
      await sleep(500)
    }

    try {
      await ensurePortFree(port)
    } catch (retryError) {
      const updatedInspection = inspectPortOccupants(port, { includeFallbackSnapshot: isVerboseLogging })
      const message = retryError instanceof Error ? retryError.message : String(retryError)
      console.error(`[dev-preflight] Cannot start LoopTroop ${label} service on port ${port}: ${message}`)
      console.error(`[dev-preflight] ${describePortOccupants(port, updatedInspection)}`)
      if (isVerboseLogging && updatedInspection.rawSocketSnapshot) {
        console.error('[dev-preflight] Listener snapshot:')
        console.error(updatedInspection.rawSocketSnapshot)
      }
      if (error instanceof Error && error.message) {
        console.error(`[dev-preflight] Initial check failed with: ${error.message}`)
      }
      process.exit(1)
    }
  }
}

writeDevPreflightReport({
  generatedAt: new Date().toISOString(),
  install: installReport,
  dependencySync: dependencySyncReport,
  audit: auditReport,
  opencode: opencodeReport,
})
