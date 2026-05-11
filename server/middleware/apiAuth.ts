import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

export const API_TOKEN_HEADER = 'x-looptroop-token'
export const API_TOKEN_QUERY_PARAM = 'apiToken'

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
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function getRequestToken(c: Context): string | null {
  return c.req.header(API_TOKEN_HEADER)?.trim()
    || getBearerToken(c.req.header('authorization'))
    || c.req.query(API_TOKEN_QUERY_PARAM)?.trim()
    || null
}

export function createApiAuthMiddleware(options: ApiAuthOptions = {}) {
  const configuredToken = options.token ?? process.env.LOOPTROOP_API_TOKEN?.trim()
  const allowUnauthenticated = process.env.LOOPTROOP_ALLOW_UNAUTHENTICATED === '1'

  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS') {
      await next()
      return
    }

    if (!configuredToken) {
      if (allowUnauthenticated) {
        console.warn('[apiAuth] Running without API token authentication. Set LOOPTROOP_API_TOKEN to secure the API.')
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
