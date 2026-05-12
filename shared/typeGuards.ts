export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !(value instanceof Map)
    && !(value instanceof Set)
    && !(value instanceof RegExp)
}

/** Returns error.message for Error instances, String(value) for everything else. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Returns the trimmed string if non-empty, undefined otherwise. */
export function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
