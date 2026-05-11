import type { Context, Next } from 'hono'

export const MAX_API_JSON_BODY_BYTES = 2 * 1024 * 1024

export async function validateJson(c: Context, next: Next) {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const contentType = c.req.header('content-type')
    if (contentType && !contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      return c.json({ error: 'Content-Type must be application/json' }, 415)
    }

    const contentLength = c.req.header('content-length')
    if (contentLength) {
      const length = Number(contentLength)
      if (!Number.isFinite(length) || length < 0) {
        return c.json({ error: 'Invalid Content-Length header' }, 400)
      }
      if (length > MAX_API_JSON_BODY_BYTES) {
        return c.json({ error: `Request body exceeds ${MAX_API_JSON_BODY_BYTES} bytes` }, 413)
      }
    }
  }
  await next()
}
