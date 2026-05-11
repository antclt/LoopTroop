import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAllowedBackendHost, getBackendOrigin, getBackendPort, getDocsPort, getFrontendOrigin, getFrontendPort } from '../appConfig'

const ORIGINAL_ENV = {
  LOOPTROOP_BACKEND_PORT: process.env.LOOPTROOP_BACKEND_PORT,
  LOOPTROOP_BACKEND_HOST: process.env.LOOPTROOP_BACKEND_HOST,
  LOOPTROOP_ALLOW_REMOTE_API: process.env.LOOPTROOP_ALLOW_REMOTE_API,
  LOOPTROOP_DOCS_PORT: process.env.LOOPTROOP_DOCS_PORT,
  LOOPTROOP_FRONTEND_ORIGIN: process.env.LOOPTROOP_FRONTEND_ORIGIN,
  LOOPTROOP_FRONTEND_PORT: process.env.LOOPTROOP_FRONTEND_PORT,
}

describe('appConfig frontend origin', () => {
  afterEach(() => {
    if (ORIGINAL_ENV.LOOPTROOP_BACKEND_PORT === undefined) {
      delete process.env.LOOPTROOP_BACKEND_PORT
    } else {
      process.env.LOOPTROOP_BACKEND_PORT = ORIGINAL_ENV.LOOPTROOP_BACKEND_PORT
    }

    if (ORIGINAL_ENV.LOOPTROOP_BACKEND_HOST === undefined) {
      delete process.env.LOOPTROOP_BACKEND_HOST
    } else {
      process.env.LOOPTROOP_BACKEND_HOST = ORIGINAL_ENV.LOOPTROOP_BACKEND_HOST
    }

    if (ORIGINAL_ENV.LOOPTROOP_ALLOW_REMOTE_API === undefined) {
      delete process.env.LOOPTROOP_ALLOW_REMOTE_API
    } else {
      process.env.LOOPTROOP_ALLOW_REMOTE_API = ORIGINAL_ENV.LOOPTROOP_ALLOW_REMOTE_API
    }

    if (ORIGINAL_ENV.LOOPTROOP_DOCS_PORT === undefined) {
      delete process.env.LOOPTROOP_DOCS_PORT
    } else {
      process.env.LOOPTROOP_DOCS_PORT = ORIGINAL_ENV.LOOPTROOP_DOCS_PORT
    }

    if (ORIGINAL_ENV.LOOPTROOP_FRONTEND_ORIGIN === undefined) {
      delete process.env.LOOPTROOP_FRONTEND_ORIGIN
    } else {
      process.env.LOOPTROOP_FRONTEND_ORIGIN = ORIGINAL_ENV.LOOPTROOP_FRONTEND_ORIGIN
    }

    if (ORIGINAL_ENV.LOOPTROOP_FRONTEND_PORT === undefined) {
      delete process.env.LOOPTROOP_FRONTEND_PORT
    } else {
      process.env.LOOPTROOP_FRONTEND_PORT = ORIGINAL_ENV.LOOPTROOP_FRONTEND_PORT
    }
    vi.restoreAllMocks()
  })

  it('derives the default frontend origin from LOOPTROOP_FRONTEND_PORT', () => {
    delete process.env.LOOPTROOP_FRONTEND_ORIGIN
    process.env.LOOPTROOP_FRONTEND_PORT = '6199'

    expect(getFrontendOrigin()).toBe('http://localhost:6199')
  })

  it('keeps explicit LOOPTROOP_FRONTEND_ORIGIN validation and falls back to the derived port origin', () => {
    delete process.env.LOOPTROOP_FRONTEND_ORIGIN
    process.env.LOOPTROOP_FRONTEND_PORT = '6201'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    process.env.LOOPTROOP_FRONTEND_ORIGIN = 'not a url'

    expect(getFrontendOrigin()).toBe('http://localhost:6201')
    expect(warnSpy).toHaveBeenCalledWith(
      '[config] Invalid LOOPTROOP_FRONTEND_ORIGIN: not a url. Falling back to http://localhost:6201.',
    )
  })

  it('rejects configured ports outside the valid TCP range', () => {
    process.env.LOOPTROOP_FRONTEND_PORT = '0'
    process.env.LOOPTROOP_DOCS_PORT = '65536'
    process.env.LOOPTROOP_BACKEND_PORT = '-1'

    expect(getFrontendPort()).toBe(5173)
    expect(getDocsPort()).toBe(5174)
    expect(getBackendPort()).toBe(3000)
  })

  it('defaults backend origin to loopback and blocks remote binds without opt-in', () => {
    delete process.env.LOOPTROOP_BACKEND_HOST
    process.env.LOOPTROOP_BACKEND_PORT = '3005'
    expect(getBackendOrigin()).toBe('http://127.0.0.1:3005')
    expect(getAllowedBackendHost()).toBe('127.0.0.1')

    process.env.LOOPTROOP_BACKEND_HOST = '0.0.0.0'
    expect(() => getAllowedBackendHost()).toThrow('Refusing to bind LoopTroop API')

    process.env.LOOPTROOP_ALLOW_REMOTE_API = '1'
    expect(getAllowedBackendHost()).toBe('0.0.0.0')
  })
})
