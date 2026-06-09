import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../AppShell'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'
import { TEST } from '@/test/factories'
import type { Project } from '@/hooks/useProjects'

vi.mock('@/hooks/useBackendHealth', () => ({
  useBackendHealth: vi.fn(() => ({ isOffline: false })),
}))

const useRecoveryAutoReloadMock = vi.hoisted(() => vi.fn())
const mockUseProjects = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useRecoveryAutoReload', () => ({
  useRecoveryAutoReload: useRecoveryAutoReloadMock,
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
}))

import { useBackendHealth } from '@/hooks/useBackendHealth'

const projects: Project[] = [
  {
    id: 1,
    name: 'Lumen Console',
    shortname: TEST.shortname,
    icon: 'L',
    color: '#2563eb',
    folderPath: '/tmp/lumen-console',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    executionSetupTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'Ledger Tools',
    shortname: TEST.shortnameB,
    icon: 'L',
    color: '#16a34a',
    folderPath: '/tmp/ledger',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    executionSetupTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 3,
    name: 'Acme Console',
    shortname: TEST.shortnameC,
    icon: 'A',
    color: '#f97316',
    folderPath: '/tmp/acme',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    executionSetupTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function makeUIValue(overrides: Partial<UIContextValue['state']> = {}, dispatch = vi.fn()): UIContextValue {
  return {
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
      ...overrides,
    },
    dispatch,
  }
}

function renderShell(uiValue = makeUIValue()) {
  return renderWithProviders(
    <UIContext.Provider value={uiValue}>
      <AppShell>
        <div>Dashboard</div>
      </AppShell>
    </UIContext.Provider>,
  )
}

const uiValue: UIContextValue = makeUIValue({
  filters: {
    projectId: null,
    status: null,
    search: '',
  },
})

describe('AppShell', () => {
  beforeEach(() => {
    useRecoveryAutoReloadMock.mockReset()
    mockUseProjects.mockReturnValue({ data: projects })
  })

  it('renders a docs link that opens in a new tab', () => {
    renderShell(uiValue)

    const docsLink = screen.getByRole('link', { name: /docs/i })
    expect(docsLink).toHaveAttribute('href', __LOOPTROOP_DOCS_ORIGIN__)
    expect(docsLink).toHaveAttribute('target', '_blank')
    expect(docsLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('dispatches search filter updates immediately as the user types', () => {
    const dispatch = vi.fn()

    renderShell(makeUIValue({}, dispatch))

    fireEvent.change(screen.getByRole('searchbox', { name: /search tickets/i }), {
      target: { value: 'LOO-15' },
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FILTER',
      filter: { search: 'LOO-15' },
    })
  })

  it('clears the dashboard search from the input icon slot', () => {
    const dispatch = vi.fn()

    renderShell(makeUIValue({
      filters: {
        projectId: null,
        status: null,
        search: 'Loop',
      },
    }, dispatch))

    fireEvent.click(screen.getByRole('button', { name: /clear ticket search/i }))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FILTER',
      filter: { search: '' },
    })
  })

  it('clears the focused dashboard search with Escape', () => {
    const dispatch = vi.fn()

    renderShell(makeUIValue({
      filters: {
        projectId: null,
        status: null,
        search: 'Loop',
      },
    }, dispatch))

    fireEvent.keyDown(screen.getByRole('searchbox', { name: /search tickets/i }), { key: 'Escape' })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FILTER',
      filter: { search: '' },
    })
  })

  it('suggests only project names that start with the typed search', () => {
    const dispatch = vi.fn()

    renderShell(makeUIValue({
      filters: {
        projectId: null,
        status: null,
        search: 'l',
      },
    }, dispatch))

    fireEvent.focus(screen.getByRole('searchbox', { name: /search tickets/i }))

    expect(screen.getByRole('option', { name: 'Lumen Console' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ledger Tools' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Acme Console' })).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Lumen Console' }))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FILTER',
      filter: { search: 'Lumen Console' },
    })
  })

  it('does not show the reconnecting banner when backend is reachable', () => {
    vi.mocked(useBackendHealth).mockReturnValue({ isOffline: false })

    renderShell(uiValue)

    expect(screen.queryByTestId('backend-reconnecting-banner')).not.toBeInTheDocument()
    expect(useRecoveryAutoReloadMock).toHaveBeenCalledWith('backend-reconnect', false)
  })

  it('shows the reconnecting banner when backend is unreachable', () => {
    vi.mocked(useBackendHealth).mockReturnValue({ isOffline: true })

    renderShell(uiValue)

    expect(screen.getByTestId('backend-reconnecting-banner')).toBeInTheDocument()
    expect(screen.getByText(/reconnecting to server/i)).toBeInTheDocument()
    expect(useRecoveryAutoReloadMock).toHaveBeenCalledWith('backend-reconnect', true)
  })
})
