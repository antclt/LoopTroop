import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearNeedsInputSeen,
  getNeedsInputSignature,
  markNeedsInputSeen,
  readNeedsInputSeen,
} from '@/lib/needsInputSeen'

const baseSnapshot = {
  id: '1:TEST-1',
  status: 'WAITING_PRD_APPROVAL',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('getNeedsInputSignature', () => {
  it('returns a status|updatedAt signature for needs_input statuses', () => {
    expect(getNeedsInputSignature(baseSnapshot)).toBe('WAITING_PRD_APPROVAL|2026-01-01T00:00:00.000Z')
  })

  it('returns null for BLOCKED_ERROR (red error owns that status)', () => {
    expect(getNeedsInputSignature({ ...baseSnapshot, status: 'BLOCKED_ERROR' })).toBeNull()
  })

  it('returns null for non-needs-input statuses', () => {
    expect(getNeedsInputSignature({ ...baseSnapshot, status: 'DRAFT' })).toBeNull()
    expect(getNeedsInputSignature({ ...baseSnapshot, status: 'CODING' })).toBeNull()
    expect(getNeedsInputSignature({ ...baseSnapshot, status: 'COMPLETED' })).toBeNull()
  })

  it('produces a different signature when the wait reason changes (different status)', () => {
    const prd = getNeedsInputSignature(baseSnapshot)
    const beads = getNeedsInputSignature({ ...baseSnapshot, status: 'WAITING_BEADS_APPROVAL' })
    expect(prd).not.toBe(beads)
  })

  it('produces a different signature on re-entry with a fresh updatedAt', () => {
    const first = getNeedsInputSignature(baseSnapshot)
    const reentered = getNeedsInputSignature({ ...baseSnapshot, updatedAt: '2026-01-02T00:00:00.000Z' })
    expect(first).not.toBe(reentered)
  })
})

describe('readNeedsInputSeen / markNeedsInputSeen / clearNeedsInputSeen', () => {
  beforeEach(() => {
    clearNeedsInputSeen(baseSnapshot.id)
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false for a null signature', () => {
    expect(readNeedsInputSeen(baseSnapshot.id, null)).toBe(false)
  })

  it('returns false before marking and true after marking', () => {
    const sig = getNeedsInputSignature(baseSnapshot)!
    expect(readNeedsInputSeen(baseSnapshot.id, sig)).toBe(false)
    markNeedsInputSeen(baseSnapshot.id, sig)
    expect(readNeedsInputSeen(baseSnapshot.id, sig)).toBe(true)
  })

  it('honors a persisted signature from the server (cross-tab recovery)', () => {
    const sig = getNeedsInputSignature(baseSnapshot)!
    expect(readNeedsInputSeen(baseSnapshot.id, sig, sig)).toBe(true)
  })

  it('clears the seen state', () => {
    const sig = getNeedsInputSignature(baseSnapshot)!
    markNeedsInputSeen(baseSnapshot.id, sig)
    expect(readNeedsInputSeen(baseSnapshot.id, sig)).toBe(true)
    clearNeedsInputSeen(baseSnapshot.id)
    expect(readNeedsInputSeen(baseSnapshot.id, sig)).toBe(false)
  })

  it('a new wait signature is unseen again after a prior one was acknowledged', () => {
    const first = getNeedsInputSignature(baseSnapshot)!
    markNeedsInputSeen(baseSnapshot.id, first)
    expect(readNeedsInputSeen(baseSnapshot.id, first)).toBe(true)
    const second = getNeedsInputSignature({
      ...baseSnapshot,
      status: 'WAITING_BEADS_APPROVAL',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })!
    expect(readNeedsInputSeen(baseSnapshot.id, second)).toBe(false)
  })

  it('treats a persisted null signature as not seen', () => {
    const sig = getNeedsInputSignature(baseSnapshot)!
    markNeedsInputSeen(baseSnapshot.id, sig)
    expect(readNeedsInputSeen(baseSnapshot.id, sig, null)).toBe(true)
  })
})
