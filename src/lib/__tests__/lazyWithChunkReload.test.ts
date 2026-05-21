import { describe, expect, it, vi } from 'vitest'
import {
  isRecoverableLazyImportError,
  requestLazyImportReload,
} from '../lazyWithChunkReload'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

describe('lazyWithChunkReload', () => {
  it('identifies dynamic import and chunk load failures as recoverable', () => {
    expect(isRecoverableLazyImportError(new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:5173/src/components/config/ProfileSetup.tsx',
    ))).toBe(true)
    expect(isRecoverableLazyImportError(new Error('Loading chunk 42 failed.'))).toBe(true)
    expect(isRecoverableLazyImportError(new Error('ChunkLoadError: Loading chunk workspace failed.'))).toBe(true)
  })

  it('does not classify normal render errors as lazy import failures', () => {
    expect(isRecoverableLazyImportError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isRecoverableLazyImportError('Failed to fetch tickets')).toBe(false)
    expect(isRecoverableLazyImportError(null)).toBe(false)
  })

  it('requests only one reload per lazy module label', () => {
    const storage = createStorage()
    const reload = vi.fn()

    expect(requestLazyImportReload('ProfileSetup', storage, reload)).toBe(true)
    expect(requestLazyImportReload('ProfileSetup', storage, reload)).toBe(false)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith('looptroop-lazy-reload:ProfileSetup', 'pending')
  })
})
