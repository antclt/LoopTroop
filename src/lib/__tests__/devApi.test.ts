import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('devApi', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps default API URLs on the frontend origin', async () => {
    const { getApiUrl } = await import('../devApi')

    expect(getApiUrl('/api/stream')).toBe(`${window.location.origin}/api/stream`)
    expect(getApiUrl('/api/stream', { directInDevelopment: true })).toBe(`${window.location.origin}/api/stream`)
  })

  it('builds direct backend readiness probe URLs for development', async () => {
    const { __devApiForTests } = await import('../devApi')

    expect(__devApiForTests.getDevReadyProbeUrl('/api/health')).toBe(`${__LOOPTROOP_DEV_BACKEND_ORIGIN__}/api/health`)
  })

  it('treats a rate-limited health response as proof that the backend is reachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Too many requests.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const { pingDevBackend } = await import('../devApi')

    await expect(pingDevBackend()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }))
  })
})
