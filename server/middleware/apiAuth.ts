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

  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS' || !configuredToken) {
      await next()
      return
    }

    const requestToken = getRequestToken(c)
    if (!requestToken || !constantTimeEquals(requestToken, configuredToken)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
  }
}
