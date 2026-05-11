import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  AUTOSAVE_RATE_LIMIT_MAX,
  createApiRateLimitMiddleware,
} from '../rateLimit'

function createRateLimitApp(options: Parameters<typeof createApiRateLimitMiddleware>[0] = {}) {
  const app = new Hono()
  app.use('/api/*', createApiRateLimitMiddleware({
    now: () => 1_000,
    ...options,
  }))
  app.put('/api/tickets/:id/ui-state', (c) => c.json({ ok: true, kind: 'autosave' }))
  app.post('/api/tickets/:id/start', (c) => c.json({ ok: true, kind: 'workflow' }))
  return app
}

describe('API rate limit middleware', () => {
  it('allows a normal autosave cadence within the default local-tool budget', async () => {
    const app = createRateLimitApp()

    for (let index = 0; index < 60; index += 1) {
      const response = await app.request('/api/tickets/1:TEST-1/ui-state', { method: 'PUT' })
      expect(response.status).toBe(200)
    }

    expect(AUTOSAVE_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(60)
  })

  it('uses an autosave bucket separate from workflow write actions', async () => {
    const app = createRateLimitApp({
      autosaveLimitMax: 2,
      writeLimitMax: 1,
      windowMs: 60_000,
    })

    expect((await app.request('/api/tickets/1:TEST-1/ui-state', { method: 'PUT' })).status).toBe(200)
    expect((await app.request('/api/tickets/1:TEST-1/ui-state', { method: 'PUT' })).status).toBe(200)

    const autosaveLimited = await app.request('/api/tickets/1:TEST-1/ui-state', { method: 'PUT' })
    expect(autosaveLimited.status).toBe(429)
    expect(autosaveLimited.headers.get('Retry-After')).toBe('60')

    expect((await app.request('/api/tickets/1:TEST-1/start', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/tickets/1:TEST-1/start', { method: 'POST' })).status).toBe(429)
  })
})
