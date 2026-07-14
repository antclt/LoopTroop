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
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/tickets', (c) => c.json([]))
  return app
}

const TEST_TICKET_ROUTE = '/api/tickets/test-ticket-1'

describe('API rate limit middleware', () => {
  it('keeps the liveness probe available after the normal read budget is exhausted', async () => {
    const app = createRateLimitApp({ readLimitMax: 1 })

    expect((await app.request('/api/tickets')).status).toBe(200)
    expect((await app.request('/api/tickets')).status).toBe(429)
    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/health')).status).toBe(200)
  })

  it('allows a normal autosave cadence within the default local-tool budget', async () => {
    const app = createRateLimitApp()

    for (let index = 0; index < 60; index += 1) {
      const response = await app.request(`${TEST_TICKET_ROUTE}/ui-state`, { method: 'PUT' })
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

    expect((await app.request(`${TEST_TICKET_ROUTE}/ui-state`, { method: 'PUT' })).status).toBe(200)
    expect((await app.request(`${TEST_TICKET_ROUTE}/ui-state`, { method: 'PUT' })).status).toBe(200)

    const autosaveLimited = await app.request(`${TEST_TICKET_ROUTE}/ui-state`, { method: 'PUT' })
    expect(autosaveLimited.status).toBe(429)
    expect(autosaveLimited.headers.get('Retry-After')).toBe('60')

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, { method: 'POST' })).status).toBe(200)
    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, { method: 'POST' })).status).toBe(429)
  })

  it('ignores forwarded IP headers unless proxy trust is explicitly enabled', async () => {
    const app = createRateLimitApp({
      writeLimitMax: 1,
      trustProxy: false,
    })

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.1' },
    })).status).toBe(200)

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.2' },
    })).status).toBe(429)
  })

  it('uses forwarded IP buckets only when proxy trust is enabled', async () => {
    const app = createRateLimitApp({
      writeLimitMax: 1,
      trustProxy: true,
    })

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.1' },
    })).status).toBe(200)

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.2' },
    })).status).toBe(200)
  })

  it('prunes stale buckets and caps bucket growth', async () => {
    let now = 1_000
    const buckets = new Map()
    const app = createRateLimitApp({
      buckets,
      trustProxy: true,
      maxBuckets: 2,
      windowMs: 10,
      now: () => now,
    })

    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.1' },
    })).status).toBe(200)
    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.2' },
    })).status).toBe(200)

    now = 1_011
    expect((await app.request(`${TEST_TICKET_ROUTE}/start`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.0.2.3' },
    })).status).toBe(200)

    expect(buckets.size).toBeLessThanOrEqual(2)
  })
})
