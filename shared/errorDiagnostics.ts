export type BlockedErrorDiagnosticKind =
  | 'opencode_provider'
  | 'opencode_session'
  | 'timeout'
  | 'transport'
  | 'runtime'
  | 'unknown'

export type BlockedErrorDiagnosticSource = 'opencode' | 'provider' | 'system' | 'runtime'

export interface BlockedErrorDiagnostics {
  kind: BlockedErrorDiagnosticKind
  source: BlockedErrorDiagnosticSource
  summary: string
  modelId?: string
  sessionId?: string
  statusCode?: number
  requestModel?: string
  isRetryable?: boolean
  providerErrorType?: string
  providerErrorTitle?: string
  providerErrorMessage?: string
  responseBodyPreview?: string
}

import { isRecord } from './typeGuards'

const REDACTED = '[redacted]'
const CREDENTIAL_WORD_KEY_PATTERN = String.raw`(?:x[-_\s]?api[-_\s]?key|api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|password|secret)`
const CREDENTIAL_VALUE_PATTERN = /(["']?(?:authorization|x[-_\s]?api[-_\s]?key|api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|password|secret)["']?\s*[:=]\s*)(["']?)(?:Bearer\s+)?([^"',\s}&]+)(\2)/gi
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi
const CREDENTIAL_WORD_PATTERN = new RegExp(
  String.raw`\b(${CREDENTIAL_WORD_KEY_PATTERN})\s+(?:is\s+)?(["']?)([^"',\s}&]+)(\2)`,
  'gi',
)

function redactSensitive(value: string): string {
  CREDENTIAL_VALUE_PATTERN.lastIndex = 0
  BEARER_TOKEN_PATTERN.lastIndex = 0
  CREDENTIAL_WORD_PATTERN.lastIndex = 0
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(CREDENTIAL_VALUE_PATTERN, (_match, prefix: string, quote: string, _secret: string, closingQuote: string) =>
      `${prefix}${quote}${REDACTED}${closingQuote}`,
    )
    .replace(CREDENTIAL_WORD_PATTERN, (_match, key: string, quote: string, _secret: string, closingQuote: string) =>
      `${key} ${quote}${REDACTED}${closingQuote}`,
    )
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
}

function cleanString(value: unknown, maxLength = 1000): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = redactSensitive(value.trim())
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function cleanKind(value: unknown): BlockedErrorDiagnosticKind | undefined {
  if (
    value === 'opencode_provider'
    || value === 'opencode_session'
    || value === 'timeout'
    || value === 'transport'
    || value === 'runtime'
    || value === 'unknown'
  ) {
    return value
  }
  return undefined
}

function cleanSource(value: unknown): BlockedErrorDiagnosticSource | undefined {
  if (value === 'opencode' || value === 'provider' || value === 'system' || value === 'runtime') {
    return value
  }
  return undefined
}

export function normalizeBlockedErrorDiagnostics(value: unknown): BlockedErrorDiagnostics | null {
  if (!isRecord(value)) return null

  const summary = cleanString(value.summary)
    ?? cleanString(value.providerErrorMessage)
    ?? cleanString(value.providerErrorTitle)
    ?? cleanString(value.providerErrorType)
  if (!summary) return null

  const modelId = cleanString(value.modelId, 240)
  const sessionId = cleanString(value.sessionId, 240)
  const requestModel = cleanString(value.requestModel, 240)
  const providerErrorType = cleanString(value.providerErrorType, 240)
  const providerErrorTitle = cleanString(value.providerErrorTitle, 500)
  const providerErrorMessage = cleanString(value.providerErrorMessage)
  const responseBodyPreview = cleanString(value.responseBodyPreview)

  return {
    kind: cleanKind(value.kind) ?? 'unknown',
    source: cleanSource(value.source) ?? 'system',
    summary,
    ...(modelId ? { modelId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(cleanNumber(value.statusCode) !== undefined ? { statusCode: cleanNumber(value.statusCode) } : {}),
    ...(requestModel ? { requestModel } : {}),
    ...(cleanBoolean(value.isRetryable) !== undefined ? { isRetryable: cleanBoolean(value.isRetryable) } : {}),
    ...(providerErrorType ? { providerErrorType } : {}),
    ...(providerErrorTitle ? { providerErrorTitle } : {}),
    ...(providerErrorMessage ? { providerErrorMessage } : {}),
    ...(responseBodyPreview ? { responseBodyPreview } : {}),
  }
}
