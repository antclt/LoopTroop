import { randomBytes } from 'node:crypto'
import concurrently from 'concurrently'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OPENCODE_BASE_URL, getBackendPort, getDocsOrigin, getDocsPort, getFrontendPort } from '../shared/appConfig'
import { readDevPreflightReport } from './dev-maintenance'
import { resolveOpenCodeBaseUrl } from './opencode-dev-base-url'
import { getErrorMessage } from '../shared/typeGuards'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const requestedBaseUrl = process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
const hasExplicitBaseUrl = Boolean(process.env.LOOPTROOP_OPENCODE_BASE_URL?.trim())
const childEnv = { ...process.env }
const isStartupMaintenanceOptedIn = process.env.LOOPTROOP_DEV_FORCE_MAINTENANCE === '1'
const preflightReport = readDevPreflightReport()
let shutdownSignal: NodeJS.Signals | null = null
let shutdownStartedAtMs: number | null = null

delete childEnv.NO_COLOR
delete childEnv.FORCE_COLOR

type DevService = {
  name: string
  prefixColor: string
  command: string
  displayCommand: string
  description: string
}

const { baseUrl, note, status } = await resolveOpenCodeBaseUrl({
  requestedBaseUrl,
  hasExplicitBaseUrl,
  mockMode: process.env.LOOPTROOP_OPENCODE_MODE === 'mock',
})

if (note) {
  console.log(`[dev] ${note}`)
}

if (status === 'ready-to-start' && !childEnv.OPENCODE_SERVER_PASSWORD?.trim()) {
  childEnv.OPENCODE_SERVER_USERNAME = childEnv.OPENCODE_SERVER_USERNAME?.trim() || 'opencode'
  childEnv.OPENCODE_SERVER_PASSWORD = randomBytes(18).toString('base64url')
  console.log('[dev] Securing the local OpenCode dev server with ephemeral basic auth.')
}

if (!childEnv.LOOPTROOP_API_TOKEN?.trim()) {
  childEnv.LOOPTROOP_API_TOKEN = randomBytes(24).toString('base64url')
  console.log('[dev] Securing the local LoopTroop API with an ephemeral token.')
}

function printSummaryLine(label: string, value: string) {
  console.log(`[dev] ${label.padEnd(13)} ${value}`)
}

function printDivider(title: string) {
  const bar = '='.repeat(18)
  console.log(`[dev] ${bar} ${title} ${bar}`)
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s'
  }

  if (seconds > 0 && seconds < 1) {
    return '<1s'
  }

  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  parts.push(`${remainingSeconds}s`)
  return parts.join(' ')
}

function formatMaintenanceTimestamp(timestamp?: string) {
  if (!timestamp) {
    return 'unknown time'
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const services: DevService[] = [
  {
    name: 'OPEN',
    prefixColor: 'bgYellow.black',
    command: 'npm:dev:opencode',
    displayCommand: 'tsx scripts/dev-opencode.ts',
    description: 'Ensure the local OpenCode server is reachable, then start it if needed.',
  },
  {
    name: 'WEB',
    prefixColor: 'bgBlue.black',
    command: 'npm:dev:frontend',
    displayCommand: 'vite',
    description: 'Start the frontend dev server for the LoopTroop dashboard.',
  },
  {
    name: 'API',
    prefixColor: 'bgGreen.black',
    command: 'npm:dev:backend',
    displayCommand: 'tsx scripts/dev-backend.ts',
    description: 'Watch the backend and restart it when server files change.',
  },
  {
    name: 'DOCS',
    prefixColor: 'bgMagenta.black',
    command: 'npm:docs:dev',
    displayCommand: 'tsx scripts/dev-docs.ts',
    description: 'Serve the VitePress documentation site alongside the app.',
  },
]

printDivider('Startup Summary')
printSummaryLine('Frontend', `http://localhost:${getFrontendPort()}`)
printSummaryLine('Backend', `http://localhost:${getBackendPort()}`)
printSummaryLine('Docs', `${getDocsOrigin()} (port ${getDocsPort()})`)
printSummaryLine('OpenCode', baseUrl)

if (preflightReport) {
  if (preflightReport.opencode.skipped) {
    printSummaryLine('OpenCode CLI', 'Skipped automatic OpenCode upgrade via LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1')
  } else if (preflightReport.opencode.deferred) {
    printSummaryLine(
      'OpenCode CLI',
      isStartupMaintenanceOptedIn && preflightReport.opencode.lastCompletedAt
        ? `Deferred opt-in upgrade check; last completed today at ${formatMaintenanceTimestamp(preflightReport.opencode.lastCompletedAt)}`
        : 'Not run during startup; use npm run opencode:upgrade or LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev',
    )
  } else if (!preflightReport.opencode.available) {
    printSummaryLine('OpenCode CLI', 'Local opencode binary not found; skipped automatic CLI upgrade')
  } else if (preflightReport.opencode.upgraded) {
    printSummaryLine(
      'OpenCode CLI',
      `Upgraded ${preflightReport.opencode.versionBefore ?? 'unknown'} -> ${preflightReport.opencode.versionAfter ?? 'unknown'}` +
      (preflightReport.opencode.method ? ` via ${preflightReport.opencode.method}` : ''),
    )
  } else {
    printSummaryLine(
      'OpenCode CLI',
      `Already current at ${preflightReport.opencode.versionAfter ?? preflightReport.opencode.versionBefore ?? 'unknown'}` +
      (preflightReport.opencode.method ? ` via ${preflightReport.opencode.method}` : ''),
    )
  }

  if (preflightReport.dependencySync.skipped) {
    printSummaryLine('Dependencies', 'Skipped automatic dependency sync via LOOPTROOP_DEV_SKIP_DEPS=1')
  } else if (preflightReport.dependencySync.deferred) {
    printSummaryLine(
      'Dependencies',
      isStartupMaintenanceOptedIn && preflightReport.dependencySync.lastCompletedAt
        ? `Deferred opt-in npm latest check; last completed today at ${formatMaintenanceTimestamp(preflightReport.dependencySync.lastCompletedAt)}`
        : 'Not run during startup; use npm run deps:sync or LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev',
    )
  } else if (preflightReport.dependencySync.alreadyCurrent) {
    printSummaryLine('Dependencies', 'All direct dependencies already matched npm latest stable')
  } else {
    printSummaryLine(
      'Dependencies',
      `Updated ${preflightReport.dependencySync.updatedDependencies.length} runtime and ` +
      `${preflightReport.dependencySync.updatedDevDependencies.length} dev packages to latest stable` +
      (preflightReport.dependencySync.isForced ? ' (with npm --force fallback)' : ''),
    )
  }

  if (preflightReport.audit.skipped) {
    printSummaryLine('Audit', 'Skipped automatic audit remediation via LOOPTROOP_DEV_SKIP_DEPS=1')
  } else if (preflightReport.audit.deferred) {
    printSummaryLine(
      'Audit',
      isStartupMaintenanceOptedIn && preflightReport.audit.lastCompletedAt
        ? `Deferred opt-in remediation; last completed today at ${formatMaintenanceTimestamp(preflightReport.audit.lastCompletedAt)}`
        : 'Not run during startup; use npm run audit:remediate or LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev',
    )
  } else if (preflightReport.audit.unresolved.length === 0) {
    printSummaryLine('Audit', 'No remaining npm audit findings after remediation')
  } else {
    printSummaryLine(
      'Audit',
      `${preflightReport.audit.totals.total} remaining finding(s): ` +
      `high=${preflightReport.audit.totals.high}, moderate=${preflightReport.audit.totals.moderate}`,
    )
    for (const issue of preflightReport.audit.unresolved.slice(0, 3)) {
      console.log(`[dev]   - ${issue.name} (${issue.severity})${issue.note ? `: ${issue.note}` : ''}`)
    }
  }
}

printDivider('Service Plan')
console.log('[dev] Step 1        Preflight checks already completed before this launcher started.')
console.log('[dev]               Purpose: install missing packages, validate ports, and leave dependency/audit/OpenCode maintenance to explicit opt-in commands.')

services.forEach((service, index) => {
  const stepNumber = index + 2
  console.log(`[dev] Step ${String(stepNumber).padEnd(8)} ${service.name}  ${service.displayCommand}`)
  console.log(`[dev]               Purpose: ${service.description}`)
})

printDivider('Live Services')
console.log('[dev] Launching frontend, backend, docs, and OpenCode watchers...')

const { commands, result } = concurrently(
  services.map((service) => ({
    command: service.command,
    name: service.name,
    prefixColor: service.prefixColor,
    env: {
      ...childEnv,
      LOOPTROOP_OPENCODE_BASE_URL: baseUrl,
    },
  })),
  {
    cwd: repoRoot,
    prefix: '[{time} {name}]',
    timestampFormat: 'HH:mm:ss',
    padPrefix: true,
    prefixColors: services.map((service) => service.prefixColor),
    timings: false,
    successCondition: 'all',
    killOthersOn: ['failure'],
  },
)

for (const command of commands) {
  command.stateChange.subscribe((state) => {
    if (state === 'started') {
      console.log(`[dev] Service ${command.name} started.`)
    }
  })

  command.error.subscribe((error) => {
    const message = getErrorMessage(error)
    console.error(`[dev] Service ${command.name} failed to spawn: ${message}`)
  })

  command.close.subscribe((event) => {
    const duration = formatDuration(event.timings.durationSeconds)

    if (shutdownSignal) {
      console.log(`[dev] Service ${command.name} stopped after ${duration} (${shutdownSignal}).`)
      return
    }

    if (event.killed) {
      const exitCode = event.exitCode == null ? 'unknown' : String(event.exitCode)
      console.log(`[dev] Service ${command.name} was terminated after ${duration} (exit ${exitCode}).`)
      return
    }

    if (event.exitCode === 0) {
      console.log(`[dev] Service ${command.name} stopped cleanly after ${duration}.`)
      return
    }

    const exitCode = event.exitCode == null ? 'unknown' : String(event.exitCode)
    console.log(`[dev] Service ${command.name} exited with ${exitCode} after ${duration}.`)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shutdownSignal) {
      return
    }

    shutdownSignal = signal
    shutdownStartedAtMs = Date.now()
    printDivider('Shutdown')
    console.log(`[dev] Received ${signal}; stopping dev services...`)
    for (const command of commands) {
      try {
        command.kill(signal)
      } catch {
        // Ignore shutdown races.
      }
    }
  })
}

try {
  await result
  if (shutdownSignal) {
    const shutdownDuration = shutdownStartedAtMs == null
      ? '0s'
      : formatDuration((Date.now() - shutdownStartedAtMs) / 1000)
    console.log(`[dev] Shutdown complete in ${shutdownDuration}.`)
  }
  process.exit(0)
} catch {
  if (shutdownSignal) {
    const shutdownDuration = shutdownStartedAtMs == null
      ? '0s'
      : formatDuration((Date.now() - shutdownStartedAtMs) / 1000)
    console.log(`[dev] Shutdown complete in ${shutdownDuration}.`)
    process.exit(0)
  }

  process.exit(1)
}
