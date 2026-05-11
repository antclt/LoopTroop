import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { MAX_API_JSON_BODY_BYTES, validateJson } from '../validation'

function createValidationApp() {
  const app = new Hono()
  app.use('/api/*', validateJson)
  app.post('/api/tickets', (c) => c.json({ ok: true }))
  return app
}

describe('JSON validation middleware', () => {
  it('rejects oversized JSON bodies before route parsing', async () => {
    const app = createValidationApp()

    const response = await app.request('/api/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_API_JSON_BODY_BYTES + 1),
      },
      body: JSON.stringify({ title: 'Too large' }),
    })

    expect(response.status).toBe(413)
  })

  it('rejects invalid content-length values', async () => {
    const app = createValidationApp()

    const response = await app.request('/api/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': 'nope',
      },
      body: JSON.stringify({ title: 'Invalid length' }),
    })

    expect(response.status).toBe(400)
  })
})
