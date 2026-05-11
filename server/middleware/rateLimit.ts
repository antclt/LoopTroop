import type { Context, Next } from 'hono'

export const RATE_LIMIT_WINDOW_MS = 60_000
export const GENERAL_RATE_LIMIT_MAX = 200
export const WRITE_RATE_LIMIT_MAX = 120
export const AUTOSAVE_RATE_LIMIT_MAX = 300

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type RateLimitBucketKind = 'read' | 'write' | 'autosave'

interface RateLimitBucket {
  count: number
  resetAt: number
}

export interface ApiRateLimitOptions {
  windowMs?: number
  readLimitMax?: number
  writeLimitMax?: number
  autosaveLimitMax?: number
  buckets?: Map<string, RateLimitBucket>
  now?: () => number
}

function getClientIp(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || c.req.header('x-real-ip')?.trim() || 'local'
}

function isAutosaveRequest(c: Context): boolean {
  return c.req.method === 'PUT' && /\/api\/tickets\/[^/]+\/ui-state$/.test(c.req.path)
}

export function classifyRateLimitBucket(c: Context): RateLimitBucketKind {
  if (isAutosaveRequest(c)) return 'autosave'
  return WRITE_METHODS.has(c.req.method) ? 'write' : 'read'
}

export function createApiRateLimitMiddleware(options: ApiRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS
  const readLimitMax = options.readLimitMax ?? GENERAL_RATE_LIMIT_MAX
  const writeLimitMax = options.writeLimitMax ?? WRITE_RATE_LIMIT_MAX
  const autosaveLimitMax = options.autosaveLimitMax ?? AUTOSAVE_RATE_LIMIT_MAX
  const buckets = options.buckets ?? new Map<string, RateLimitBucket>()
  const nowFn = options.now ?? Date.now

  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS') {
      await next()
      return
    }

    const now = nowFn()
    const bucketKind = classifyRateLimitBucket(c)
    const limit = bucketKind === 'autosave'
      ? autosaveLimitMax
      : bucketKind === 'write'
        ? writeLimitMax
        : readLimitMax
    const key = `${bucketKind}:${getClientIp(c)}`
    const currentBucket = buckets.get(key)

    if (!currentBucket || currentBucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      await next()
      return
    }

    if (currentBucket.count >= limit) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((currentBucket.resetAt - now) / 1000))))
      return c.json({ error: 'Too many requests. Please retry shortly.' }, 429)
    }

    currentBucket.count += 1
    await next()
  }
}
