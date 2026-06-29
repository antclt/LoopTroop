import { release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWslAppMountedDriveWarning, isWslWindowsMountPath } from '../shared/wslPerformance'

export const isTestRuntime = process.env.NODE_ENV === 'test'
  || process.env.VITEST === 'true'
  || process.env.VITEST === '1'

export interface RuntimeStatus {
  isWsl: boolean
  osLabel: string
  appRoot: string
  appPathWarning: string | null
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function formatOsLabel(platform: NodeJS.Platform, isWsl: boolean): string {
  if (isWsl) return 'Linux (WSL)'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

export function isWslRuntime(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  kernelRelease = release(),
): boolean {
  if (platform !== 'linux') return false
  if (env.WSL_DISTRO_NAME?.trim() || env.WSL_INTEROP?.trim()) return true
  return kernelRelease.toLowerCase().includes('microsoft')
}

export function buildRuntimeStatus(options: {
  appRoot?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  kernelRelease?: string
} = {}): RuntimeStatus {
  const appRoot = options.appRoot ?? APP_ROOT
  const platform = options.platform ?? process.platform
  const isWsl = isWslRuntime(
    platform,
    options.env,
    options.kernelRelease,
  )

  return {
    isWsl,
    osLabel: formatOsLabel(platform, isWsl),
    appRoot,
    appPathWarning: isWsl && isWslWindowsMountPath(appRoot)
      ? buildWslAppMountedDriveWarning(appRoot)
      : null,
  }
}

export function isTestLogSilenced(): boolean {
  return isTestRuntime && process.env.LOOPTROOP_TEST_SILENT === '1'
}

export function logIfVerbose(...args: Parameters<typeof console.log>) {
  if (!isTestLogSilenced()) {
    console.log(...args)
  }
}

export function warnIfVerbose(...args: Parameters<typeof console.warn>) {
  if (!isTestLogSilenced()) {
    console.warn(...args)
  }
}
