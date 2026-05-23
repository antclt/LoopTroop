import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRecoveryAutoReload } from '../useRecoveryAutoReload'

const requestRecoveryReloadMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/recoveryReload', () => ({
  requestRecoveryReload: requestRecoveryReloadMock,
}))

describe('useRecoveryAutoReload', () => {
  afterEach(() => {
    requestRecoveryReloadMock.mockReset()
  })

  it('does not reload for an initially inactive recovery state', () => {
    renderHook(() => useRecoveryAutoReload('tickets-loading', false))

    expect(requestRecoveryReloadMock).not.toHaveBeenCalled()
  })

  it('reloads once when an active recovery episode clears', () => {
    const { rerender } = renderHook(
      ({ active }) => useRecoveryAutoReload('live-updates-reconnect', active),
      { initialProps: { active: true } },
    )

    expect(requestRecoveryReloadMock).not.toHaveBeenCalled()

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
    rerender({ active: false })
    rerender({ active: true })
    rerender({ active: false })

    expect(requestRecoveryReloadMock).toHaveBeenCalledTimes(2)
  })
})
