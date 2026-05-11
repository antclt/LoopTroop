import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createApiAuthMiddleware } from '../apiAuth'

function createAuthApp(token?: string) {
  const app = new Hono()
  app.use('/api/*', createApiAuthMiddleware({ token }))
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/stream', (c) => c.json({ ok: true }))
  return app
}

describe('API auth middleware', () => {
  it('does not require auth when no token is configured', async () => {
    const app = createAuthApp('')

    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
  })

  it('accepts configured tokens from headers, bearer auth, and SSE query params', async () => {
    const app = createAuthApp('secret-token')

    expect((await app.request('/api/health', {
      headers: { 'X-LoopTroop-Token': 'secret-token' },
    })).status).toBe(200)
    expect((await app.request('/api/health', {
      headers: { Authorization: 'Bearer secret-token' },
    })).status).toBe(200)
    expect((await app.request('/api/stream?apiToken=secret-token')).status).toBe(200)
  })

  it('rejects missing or incorrect tokens', async () => {
    const app = createAuthApp('secret-token')

    expect((await app.request('/api/health')).status).toBe(401)
    expect((await app.request('/api/health', {
      headers: { 'X-LoopTroop-Token': 'wrong-token' },
    })).status).toBe(401)
  })
})
