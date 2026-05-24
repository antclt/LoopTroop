import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { formatDevHttpUrl, isWildcardHost, listLanAddresses, type ResolvedDevHostMode } from './dev-host-mode'

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

export type WslLanAccessPlan = {
  enabled: boolean
  reason?: string
  windowsAddresses: string[]
  wslTargetAddress?: string
  frontendUrls: string[]
  docsUrls: string[]
  setupCommands: string[]
  cleanupCommands: string[]
}

type WslRuntimeOptions = {
  platform?: NodeJS.Platform
  env?: Partial<Record<string, string | undefined>>
  procVersion?: string | null
}

type BuildWslLanAccessPlanOptions = {
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

function isUsableIpv4Address(address: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)
    && !address.startsWith('127.')
    && !address.startsWith('169.254.')
}

function disabled(reason: string): WslLanAccessPlan {
  return {
    enabled: false,
    reason,
    windowsAddresses: [],
    frontendUrls: [],
    docsUrls: [],
    setupCommands: [],
    cleanupCommands: [],
  }
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function buildPowerShellArray(values: string[]) {
  return `@(${values.map(quotePowerShellString).join(',')})`
}

function buildPortProxyCommands(listenAddresses: string[], frontendPort: number, docsPort: number) {
  const ports = [frontendPort, docsPort]
  const windowsAddressArray = buildPowerShellArray(listenAddresses)
  const portArray = `@(${ports.join(',')})`
  const setupCommands = [[
    'Set-Service iphlpsvc -StartupType Automatic',
    'Start-Service iphlpsvc',
    `$ips=${windowsAddressArray}`,
    `$ports=${portArray}`,
    'foreach ($port in $ports) { netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null | Out-Null }',
    'foreach ($ip in $ips) { foreach ($port in $ports) { netsh interface portproxy delete v4tov4 listenaddress=$ip listenport=$port 2>$null | Out-Null; netsh interface portproxy add v4tov4 listenaddress=$ip listenport=$port connectaddress=127.0.0.1 connectport=$port } }',
    'Remove-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -ErrorAction SilentlyContinue',
    'New-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ips -LocalPort $ports -Profile Private',
  ].join('; ')]
  const cleanupCommands = [[
    `$ips=${windowsAddressArray}`,
    `$ports=${portArray}`,
    'foreach ($port in $ports) { netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null | Out-Null }',
    'foreach ($ip in $ips) { foreach ($port in $ports) { netsh interface portproxy delete v4tov4 listenaddress=$ip listenport=$port 2>$null | Out-Null } }',
    'Remove-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -ErrorAction SilentlyContinue',
  ].join('; ')]

  return { setupCommands, cleanupCommands }
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

    return unique(normalizeWindowsOutput(output).filter(isUsableIpv4Address))
  } catch {
    return []
  }
}

export function buildWslLanAccessPlan({
  hostMode,
  frontendPort,
  docsPort,
  isWsl,
  wslAddresses,
  windowsAddresses,
}: BuildWslLanAccessPlanOptions): WslLanAccessPlan {
  if (!hostMode.enabled) {
    return disabled('LAN sharing is disabled.')
  }

  if (!isWsl) {
    return disabled('Runtime is not WSL.')
  }

  if (!isWildcardHost(hostMode.bindHost)) {
    return disabled('Explicit host binding is already configured.')
  }

  const wslTargetAddress = wslAddresses.find(isUsableIpv4Address)
  const usableWindowsAddresses = unique(windowsAddresses.filter(isUsableIpv4Address))
    .filter((address) => address !== wslTargetAddress)

  if (usableWindowsAddresses.length === 0) {
    return disabled('No Windows LAN address was detected.')
  }

  const { setupCommands, cleanupCommands } = buildPortProxyCommands(usableWindowsAddresses, frontendPort, docsPort)

  return {
    enabled: true,
    windowsAddresses: usableWindowsAddresses,
    wslTargetAddress,
    frontendUrls: usableWindowsAddresses.map((address) => formatDevHttpUrl(address, frontendPort)),
    docsUrls: usableWindowsAddresses.map((address) => formatDevHttpUrl(address, docsPort)),
    setupCommands,
    cleanupCommands,
  }
}

export function getWslLanAccessPlan(options: {
  hostMode: ResolvedDevHostMode
  frontendPort: number
  docsPort: number
}) {
  if (!options.hostMode.enabled) {
    return disabled('LAN sharing is disabled.')
  }

  if (!isWslRuntime()) {
    return disabled('Runtime is not WSL.')
  }

  return buildWslLanAccessPlan({
    hostMode: options.hostMode,
    frontendPort: options.frontendPort,
    docsPort: options.docsPort,
    isWsl: true,
    wslAddresses: getWslIpv4Addresses(),
    windowsAddresses: getWindowsLanAddresses(),
  })
}
