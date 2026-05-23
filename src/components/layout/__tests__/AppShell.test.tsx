import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../AppShell'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'

vi.mock('@/hooks/useBackendHealth', () => ({
  useBackendHealth: vi.fn(() => ({ isOffline: false })),
}))

const useRecoveryAutoReloadMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useRecoveryAutoReload', () => ({
  useRecoveryAutoReload: useRecoveryAutoReloadMock,
}))

import { useBackendHealth } from '@/hooks/useBackendHealth'

const uiValue: UIContextValue = {
  state: {
    selectedTicketId: null,
    selectedTicketExternalId: null,
    sidebarOpen: true,
    activeView: 'kanban',
    logPanelHeight: 300,
    filters: {
      projectId: null,
      status: null,
      search: '',
    },
    theme: 'system',
  },
  dispatch: vi.fn(),
}

describe('AppShell', () => {
  beforeEach(() => {
    useRecoveryAutoReloadMock.mockReset()
  })

  it('renders a docs link that opens in a new tab', () => {
    renderWithProviders(
      <UIContext.Provider value={uiValue}>
        <AppShell>
          <div>Dashboard</div>
        </AppShell>
      </UIContext.Provider>,
    )

    const docsLink = screen.getByRole('link', { name: /docs/i })
    expect(docsLink).toHaveAttribute('href', __LOOPTROOP_DOCS_ORIGIN__)
    expect(docsLink).toHaveAttribute('target', '_blank')
    expect(docsLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('does not show the reconnecting banner when backend is reachable', () => {
    vi.mocked(useBackendHealth).mockReturnValue({ isOffline: false })

    renderWithProviders(
      <UIContext.Provider value={uiValue}>
        <AppShell>
          <div>Dashboard</div>
        </AppShell>
      </UIContext.Provider>,
    )

    expect(screen.queryByTestId('backend-reconnecting-banner')).not.toBeInTheDocument()
    expect(useRecoveryAutoReloadMock).toHaveBeenCalledWith('backend-reconnect', false)
  })

  it('shows the reconnecting banner when backend is unreachable', () => {
    vi.mocked(useBackendHealth).mockReturnValue({ isOffline: true })

    renderWithProviders(
      <UIContext.Provider value={uiValue}>
        <AppShell>
          <div>Dashboard</div>
        </AppShell>
      </UIContext.Provider>,
    )

    expect(screen.getByTestId('backend-reconnecting-banner')).toBeInTheDocument()
    expect(screen.getByText(/reconnecting to server/i)).toBeInTheDocument()
    expect(useRecoveryAutoReloadMock).toHaveBeenCalledWith('backend-reconnect', true)
  })
})
