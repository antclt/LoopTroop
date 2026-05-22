import type { Context, Next } from 'hono'

export const MAX_API_JSON_BODY_BYTES = 2 * 1024 * 1024

class RequestBodyTooLargeError extends Error {}

async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestBodyTooLargeError('Request body too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(bytes)
}

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

    // For requests without Content-Length (e.g., chunked transfer-encoding),
    // parse the body and validate it's valid JSON within the size limit.
    // This also catches malformed JSON early before route handlers.
    if (contentType?.includes('application/json') || (!contentType && c.req.method !== 'OPTIONS')) {
      try {
        const raw = await readBodyWithinLimit(c.req.raw, MAX_API_JSON_BODY_BYTES)
        if (raw.length > 0) {
          JSON.parse(raw)
          // Re-attach the parsed body so downstream handlers can use c.req.json()
          // without re-reading the stream
          c.req.raw = new Request(c.req.raw, { body: raw })
        }
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return c.json({ error: `Request body exceeds ${MAX_API_JSON_BODY_BYTES} bytes` }, 413)
        }
        return c.json({ error: 'Invalid JSON in request body' }, 400)
      }
    }
  }
  await next()
}
