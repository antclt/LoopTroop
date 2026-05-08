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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactSensitive(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/("?(?:api[_-]?key|token|authorization|password|secret)"?\s*[:=]\s*"?)([^"',\s}]+)/gi, '$1[redacted]')
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

  return {
    kind: cleanKind(value.kind) ?? 'unknown',
    source: cleanSource(value.source) ?? 'system',
    summary,
    ...(cleanString(value.modelId, 240) ? { modelId: cleanString(value.modelId, 240) } : {}),
    ...(cleanString(value.sessionId, 240) ? { sessionId: cleanString(value.sessionId, 240) } : {}),
    ...(cleanNumber(value.statusCode) !== undefined ? { statusCode: cleanNumber(value.statusCode) } : {}),
    ...(cleanString(value.requestModel, 240) ? { requestModel: cleanString(value.requestModel, 240) } : {}),
    ...(cleanBoolean(value.isRetryable) !== undefined ? { isRetryable: cleanBoolean(value.isRetryable) } : {}),
    ...(cleanString(value.providerErrorType, 240) ? { providerErrorType: cleanString(value.providerErrorType, 240) } : {}),
    ...(cleanString(value.providerErrorTitle, 500) ? { providerErrorTitle: cleanString(value.providerErrorTitle, 500) } : {}),
    ...(cleanString(value.providerErrorMessage) ? { providerErrorMessage: cleanString(value.providerErrorMessage) } : {}),
    ...(cleanString(value.responseBodyPreview) ? { responseBodyPreview: cleanString(value.responseBodyPreview) } : {}),
  }
}
