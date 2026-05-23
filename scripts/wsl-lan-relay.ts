import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { formatDevHttpUrl, isWildcardHost, listLanAddresses, type ResolvedDevHostMode } from './dev-host-mode'

const WSL_RELAY_READY_TIMEOUT_MS = 3_000
const WINDOWS_ADDRESS_COMMAND = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$primary = Get-NetIPConfiguration |
  Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
  ForEach-Object { $_.IPv4Address.IPAddress }
if (-not $primary) {
  $primary = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.InterfaceAlias -notmatch 'Loopback|WSL|Docker|vEthernet|Hyper-V|Default Switch'
    } |
    Sort-Object InterfaceMetric |
    Select-Object -ExpandProperty IPAddress
}
$primary | Select-Object -Unique
`

const POWERSHELL_RELAY_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$listenAddress = $env:LOOPTROOP_WSL_RELAY_LISTEN_ADDRESS
$listenPort = [int]$env:LOOPTROOP_WSL_RELAY_LISTEN_PORT
$targetAddress = $env:LOOPTROOP_WSL_RELAY_TARGET_ADDRESS
$targetPort = [int]$env:LOOPTROOP_WSL_RELAY_TARGET_PORT
$endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($listenAddress), $listenPort)
$listener = [System.Net.Sockets.TcpListener]::new($endpoint)
$listener.Start()
Write-Output "READY $listenAddress $listenPort $targetAddress $targetPort"
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $state = [pscustomobject]@{
      Client = $client
      TargetAddress = $targetAddress
      TargetPort = $targetPort
    }
    [System.Threading.ThreadPool]::QueueUserWorkItem([System.Threading.WaitCallback]{
      param($state)
      $client = $state.Client
      $target = [System.Net.Sockets.TcpClient]::new()
      try {
        $target.Connect($state.TargetAddress, [int]$state.TargetPort)
        $clientStream = $client.GetStream()
        $targetStream = $target.GetStream()
        $clientToTarget = $clientStream.CopyToAsync($targetStream)
        $targetToClient = $targetStream.CopyToAsync($clientStream)
        [System.Threading.Tasks.Task]::WaitAny($clientToTarget, $targetToClient) | Out-Null
      } catch {
      } finally {
        try { $target.Close() } catch {}
        try { $client.Close() } catch {}
      }
    }, $state) | Out-Null
  }
} finally {
  $listener.Stop()
}
`

export type WslLanRelayEndpoint = {
  label: 'frontend' | 'docs'
  listenAddress: string
  listenPort: number
  targetAddress: string
  targetPort: number
}

export type WslLanRelayPlan = {
  enabled: boolean
  reason?: string
  endpoints: WslLanRelayEndpoint[]
  frontendUrls: string[]
  docsUrls: string[]
  targetAddress?: string
  listenAddresses: string[]
}

export type StartedWslLanRelay = WslLanRelayPlan & {
  warnings: string[]
  processes: ChildProcessWithoutNullStreams[]
  dispose: () => void
}

type WslRuntimeOptions = {
  platform?: NodeJS.Platform
  env?: Partial<Record<string, string | undefined>>
  procVersion?: string | null
}

type BuildWslLanRelayPlanOptions = {
  hostMode: ResolvedDevHostMode
  frontendPort: number
  docsPort: number
  isWsl: boolean
  wslAddresses: string[]
  windowsAddresses: string[]
}

function normalizeWindowsOutput(output: string) {
  return output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function readProcVersion() {
  try {
    return readFileSync('/proc/version', 'utf8')
  } catch {
    return null
  }
}

function isUsableWindowsLanAddress(address: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)
    && !address.startsWith('127.')
    && !address.startsWith('169.254.')
}

export function isWslRuntime({
  platform = process.platform,
  env = process.env,
  procVersion = readProcVersion(),
}: WslRuntimeOptions = {}) {
  if (platform !== 'linux') return false
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  return procVersion?.toLowerCase().includes('microsoft') ?? false
}

export function getWslIpv4Addresses() {
  return listLanAddresses().map((address) => address.address)
}

export function getWindowsLanAddresses() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_ADDRESS_COMMAND,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })

    return unique(normalizeWindowsOutput(output).filter(isUsableWindowsLanAddress))
  } catch {
    return []
  }
}

export function buildWslLanRelayPlan({
  hostMode,
  frontendPort,
  docsPort,
  isWsl,
  wslAddresses,
  windowsAddresses,
}: BuildWslLanRelayPlanOptions): WslLanRelayPlan {
  if (!hostMode.enabled) {
    return { enabled: false, reason: 'LAN sharing is disabled.', endpoints: [], frontendUrls: [], docsUrls: [], listenAddresses: [] }
  }

  if (!isWsl) {
    return { enabled: false, reason: 'Runtime is not WSL.', endpoints: [], frontendUrls: [], docsUrls: [], listenAddresses: [] }
  }

  if (!isWildcardHost(hostMode.bindHost)) {
    return { enabled: false, reason: 'Explicit host binding is already configured.', endpoints: [], frontendUrls: [], docsUrls: [], listenAddresses: [] }
  }

  const targetAddress = wslAddresses.find(isUsableWindowsLanAddress)
  if (!targetAddress) {
    return { enabled: false, reason: 'No WSL IPv4 target address was detected.', endpoints: [], frontendUrls: [], docsUrls: [], listenAddresses: [] }
  }

  const listenAddresses = unique(windowsAddresses.filter(isUsableWindowsLanAddress))
    .filter((address) => address !== targetAddress)

  if (listenAddresses.length === 0) {
    return { enabled: false, reason: 'No Windows LAN address was detected.', endpoints: [], frontendUrls: [], docsUrls: [], listenAddresses: [] }
  }

  const endpoints = listenAddresses.flatMap<WslLanRelayEndpoint>((listenAddress) => [
    {
      label: 'frontend',
      listenAddress,
      listenPort: frontendPort,
      targetAddress,
      targetPort: frontendPort,
    },
    {
      label: 'docs',
      listenAddress,
      listenPort: docsPort,
      targetAddress,
      targetPort: docsPort,
    },
  ])

  return {
    enabled: true,
    endpoints,
    frontendUrls: listenAddresses.map((address) => formatDevHttpUrl(address, frontendPort)),
    docsUrls: listenAddresses.map((address) => formatDevHttpUrl(address, docsPort)),
    targetAddress,
    listenAddresses,
  }
}

function startEndpointRelay(endpoint: WslLanRelayEndpoint) {
  return spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    POWERSHELL_RELAY_SCRIPT,
  ], {
    env: {
      ...process.env,
      LOOPTROOP_WSL_RELAY_LISTEN_ADDRESS: endpoint.listenAddress,
      LOOPTROOP_WSL_RELAY_LISTEN_PORT: String(endpoint.listenPort),
      LOOPTROOP_WSL_RELAY_TARGET_ADDRESS: endpoint.targetAddress,
      LOOPTROOP_WSL_RELAY_TARGET_PORT: String(endpoint.targetPort),
    },
    windowsHide: true,
  })
}

async function waitForRelayReady(child: ChildProcessWithoutNullStreams, endpoint: WslLanRelayEndpoint) {
  let stdout = ''
  let stderr = ''

  return await new Promise<{ ready: boolean, warning?: string }>((resolve) => {
    let settled = false
    const finish = (result: { ready: boolean, warning?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      finish({
        ready: child.exitCode === null,
        warning: `WSL LAN relay for ${endpoint.label} on ${endpoint.listenAddress}:${endpoint.listenPort} did not confirm readiness within ${WSL_RELAY_READY_TIMEOUT_MS / 1000}s.`,
      })
    }, WSL_RELAY_READY_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.includes('READY')) {
        finish({ ready: true })
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.once('error', (error) => {
      finish({
        ready: false,
        warning: `Failed to start WSL LAN relay for ${endpoint.label} on ${endpoint.listenAddress}:${endpoint.listenPort}: ${error.message}`,
      })
    })

    child.once('exit', (code) => {
      const detail = stderr.trim() || stdout.trim() || `exit ${code ?? 'unknown'}`
      finish({
        ready: false,
        warning: `WSL LAN relay for ${endpoint.label} on ${endpoint.listenAddress}:${endpoint.listenPort} stopped before it was ready (${detail}).`,
      })
    })
  })
}

export async function startWslLanRelay(options: {
  hostMode: ResolvedDevHostMode
  frontendPort: number
  docsPort: number
}): Promise<StartedWslLanRelay> {
  const emptyProcesses: ChildProcessWithoutNullStreams[] = []
  const disabled = (reason: string): StartedWslLanRelay => ({
    enabled: false,
    reason,
    endpoints: [],
    frontendUrls: [],
    docsUrls: [],
    listenAddresses: [],
    warnings: [],
    processes: emptyProcesses,
    dispose: () => {},
  })

  if (!options.hostMode.enabled) {
    return disabled('LAN sharing is disabled.')
  }

  if (!isWslRuntime()) {
    return disabled('Runtime is not WSL.')
  }

  const plan = buildWslLanRelayPlan({
    hostMode: options.hostMode,
    frontendPort: options.frontendPort,
    docsPort: options.docsPort,
    isWsl: true,
    wslAddresses: getWslIpv4Addresses(),
    windowsAddresses: getWindowsLanAddresses(),
  })
  const warnings: string[] = []
  const processes: ChildProcessWithoutNullStreams[] = []

  if (!plan.enabled) {
    return {
      ...plan,
      warnings,
      processes,
      dispose: () => {},
    }
  }

  const started = await Promise.all(plan.endpoints.map(async (endpoint) => {
    const child = startEndpointRelay(endpoint)
    const readiness = await waitForRelayReady(child, endpoint)

    if (readiness.warning) {
      warnings.push(readiness.warning)
    }

    if (!readiness.ready) {
      if (!child.killed) child.kill()
      return null
    }

    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) {
        console.warn(`[wsl-lan-relay] ${message}`)
      }
    })

    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        console.warn(`[wsl-lan-relay] Relay ${endpoint.listenAddress}:${endpoint.listenPort} stopped with exit ${code}.`)
      }
    })

    return { child, endpoint }
  }))

  const readyRelays = started.filter((relay): relay is { child: ChildProcessWithoutNullStreams, endpoint: WslLanRelayEndpoint } => relay !== null)
  processes.push(...readyRelays.map((relay) => relay.child))

  const readyFrontendUrls = readyRelays
    .filter((relay) => relay.endpoint.label === 'frontend')
    .map((relay) => formatDevHttpUrl(relay.endpoint.listenAddress, relay.endpoint.listenPort))
  const readyDocsUrls = readyRelays
    .filter((relay) => relay.endpoint.label === 'docs')
    .map((relay) => formatDevHttpUrl(relay.endpoint.listenAddress, relay.endpoint.listenPort))

  return {
    ...plan,
    enabled: readyRelays.length > 0,
    reason: readyRelays.length > 0 ? plan.reason : 'WSL LAN relay did not start.',
    frontendUrls: unique(readyFrontendUrls),
    docsUrls: unique(readyDocsUrls),
    warnings,
    processes,
    dispose: () => {
      for (const child of processes) {
        if (!child.killed) child.kill()
      }
    },
  }
}
