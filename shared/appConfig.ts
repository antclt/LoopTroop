const DEFAULT_FRONTEND_PORT = 5173
const DEFAULT_DOCS_PORT = 5174
const DEFAULT_BACKEND_PORT = 3000
const DEFAULT_BACKEND_HOST = '127.0.0.1'
export const DEFAULT_OPENCODE_BASE_URL = 'http://127.0.0.1:4096'

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback
}

function parseOrigin(value: string | undefined, fallback: string, envName: string): string {
  if (!value) {
    return fallback
  }

  try {
    return new URL(value).origin
  } catch {
    console.warn(`[config] Invalid ${envName}: ${value}. Falling back to ${fallback}.`)
    return fallback
  }
}

export function getFrontendPort(): number {
  return parsePort(process.env.LOOPTROOP_FRONTEND_PORT, DEFAULT_FRONTEND_PORT)
}

export function getDocsPort(): number {
  return parsePort(process.env.LOOPTROOP_DOCS_PORT, DEFAULT_DOCS_PORT)
}

export function getBackendPort(): number {
  return parsePort(process.env.LOOPTROOP_BACKEND_PORT, DEFAULT_BACKEND_PORT)
}

export function getBackendHost(): string {
  return process.env.LOOPTROOP_BACKEND_HOST?.trim() || DEFAULT_BACKEND_HOST
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized.startsWith('127.')
}

export function getAllowedBackendHost(): string {
  const host = getBackendHost()
  if (!isLoopbackHost(host) && process.env.LOOPTROOP_ALLOW_REMOTE_API !== '1') {
    throw new Error(
      `Refusing to bind LoopTroop API to non-loopback host "${host}". ` +
      'Set LOOPTROOP_ALLOW_REMOTE_API=1 only when you understand the local-control API exposure.',
    )
  }
  return host
}

export function getFrontendOrigin(): string {
  const defaultFrontendOrigin = `http://localhost:${getFrontendPort()}`
  return parseOrigin(process.env.LOOPTROOP_FRONTEND_ORIGIN, defaultFrontendOrigin, 'LOOPTROOP_FRONTEND_ORIGIN')
}

export function getDocsOrigin(): string {
  return process.env.LOOPTROOP_DOCS_ORIGIN
    ?? `http://localhost:${getDocsPort()}`
}

export function getBackendOrigin(): string {
  const host = getBackendHost()
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${urlHost}:${getBackendPort()}`
}
