import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

export const API_TOKEN_HEADER = 'x-looptroop-token'

/** @deprecated Query-parameter token transport is insecure (logged in URLs, proxies, browser history). Use header-based auth instead. */

export interface ApiAuthOptions {
  token?: string
}

function getBearerToken(value: string | undefined): string | null {
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim() || null
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  // Always perform a constant-time comparison to avoid leaking length information
  // via timing side-channels. When lengths differ, compare the expected token against
  // a zero-filled buffer of the same length so the comparison still takes constant time.
  if (left.length !== right.length) {
    return timingSafeEqual(Buffer.alloc(left.length, 0), left) && false
  }
  return timingSafeEqual(left, right)
}

const SSE_STREAM_PATH_PATTERN = /^\/api\/stream\b/

function getRequestToken(c: Context): string | null {
  return c.req.header(API_TOKEN_HEADER)?.trim()
    || getBearerToken(c.req.header('authorization'))
    // Browser EventSource API cannot set custom headers; query-param token is
    // the only viable auth mechanism for SSE streams. Restricted to /api/stream
    // to limit the surface area where tokens appear in server logs.
    || (SSE_STREAM_PATH_PATTERN.test(c.req.path) ? c.req.query('apiToken')?.trim() || null : null)
}

export function createApiAuthMiddleware(options: ApiAuthOptions = {}) {
  const configuredToken = options.token ?? process.env.LOOPTROOP_API_TOKEN?.trim()
  const allowUnauthenticated = process.env.LOOPTROOP_ALLOW_UNAUTHENTICATED === '1'

  if (!configuredToken && allowUnauthenticated && process.env.LOOPTROOP_ALLOW_REMOTE_API === '1') {
    console.error(
      '[apiAuth] CRITICAL: LOOPTROOP_ALLOW_UNAUTHENTICATED=1 with LOOPTROOP_ALLOW_REMOTE_API=1. ' +
      'The API is completely open to the network. This should NEVER be used in production.',
    )
  } else if (!configuredToken && allowUnauthenticated) {
    console.warn('[apiAuth] Running without API token authentication. Set LOOPTROOP_API_TOKEN to secure the API.')
  }

  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS') {
      await next()
      return
    }

    if (!configuredToken) {
      if (allowUnauthenticated) {
        await next()
        return
      }
      return c.json({ error: 'API token not configured' }, 503)
    }

    const requestToken = getRequestToken(c)
    if (!requestToken || !constantTimeEquals(requestToken, configuredToken)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
  }
}
