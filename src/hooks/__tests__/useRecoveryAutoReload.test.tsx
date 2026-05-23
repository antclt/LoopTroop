import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECOVERY_RELOAD_MIN_ACTIVE_MS } from '@/lib/constants'
import { useRecoveryAutoReload } from '../useRecoveryAutoReload'

const requestRecoveryReloadMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/recoveryReload', () => ({
  requestRecoveryReload: requestRecoveryReloadMock,
}))

describe('useRecoveryAutoReload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    requestRecoveryReloadMock.mockReset()
    vi.useRealTimers()
  })

  it('does not reload for an initially inactive recovery state', () => {
    renderHook(() => useRecoveryAutoReload('tickets-loading', false))

    expect(requestRecoveryReloadMock).not.toHaveBeenCalled()
  })

  it('does not reload when a recovery episode clears before the minimum visible duration', () => {
    const { rerender } = renderHook(
      ({ active }) => useRecoveryAutoReload('live-updates-reconnect', active),
      { initialProps: { active: false } },
    )

    rerender({ active: true })
    vi.setSystemTime(RECOVERY_RELOAD_MIN_ACTIVE_MS - 1)
    rerender({ active: false })

    expect(requestRecoveryReloadMock).not.toHaveBeenCalled()
  })

  it('reloads once when a sustained active recovery episode clears', () => {
    const { rerender } = renderHook(
      ({ active }) => useRecoveryAutoReload('live-updates-reconnect', active),
      { initialProps: { active: true } },
    )

    expect(requestRecoveryReloadMock).not.toHaveBeenCalled()

    vi.setSystemTime(RECOVERY_RELOAD_MIN_ACTIVE_MS)
    rerender({ active: false })
    rerender({ active: false })

    expect(requestRecoveryReloadMock).toHaveBeenCalledTimes(1)
    expect(requestRecoveryReloadMock).toHaveBeenCalledWith('live-updates-reconnect')
  })

  it('reloads for each completed episode and leaves duplicate throttling to the reload helper', () => {
    const { rerender } = renderHook(
      ({ active }) => useRecoveryAutoReload('backend-reconnect', active),
      { initialProps: { active: false } },
    )

    rerender({ active: true })
    vi.setSystemTime(RECOVERY_RELOAD_MIN_ACTIVE_MS)
    rerender({ active: false })
    rerender({ active: true })
    vi.setSystemTime(RECOVERY_RELOAD_MIN_ACTIVE_MS * 2)
    rerender({ active: false })

    expect(requestRecoveryReloadMock).toHaveBeenCalledTimes(2)
  })
})
