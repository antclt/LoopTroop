import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFrontendOrigin } from '../appConfig'

const ORIGINAL_ENV = {
  LOOPTROOP_FRONTEND_ORIGIN: process.env.LOOPTROOP_FRONTEND_ORIGIN,
  LOOPTROOP_FRONTEND_PORT: process.env.LOOPTROOP_FRONTEND_PORT,
}

describe('appConfig frontend origin', () => {
  afterEach(() => {
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
})
