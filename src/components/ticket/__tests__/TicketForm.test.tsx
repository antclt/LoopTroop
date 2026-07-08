import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'
import { TicketForm } from '../TicketForm'

const mockUseProjects = vi.hoisted(() => vi.fn())
const mockUseCreateTicket = vi.hoisted(() => vi.fn())
const mockUseTicketAction = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
}))

vi.mock('@/hooks/useTickets', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTickets')>('@/hooks/useTickets')
  return {
    ...actual,
    useCreateTicket: () => mockUseCreateTicket(),
    useTicketAction: () => mockUseTicketAction(),
  }
})

function makeFilters(): UIContextValue['state']['filters'] {
  return {
    projectId: null,
    status: null,
    phase: null,
    search: '',
    priority: null,
    stuckDays: null,
    errorState: 'none',
    sortBy: 'updatedAt_desc',
    showMocks: true,
  }
}

function makeUIValue(): UIContextValue {
  return {
    state: {
      selectedTicketId: null,
      selectedTicketExternalId: null,
      sidebarOpen: true,
      activeView: 'kanban',
      logPanelHeight: 320,
      filters: makeFilters(),
      presetsByProject: {},
      theme: 'system',
      showTriageBar: false,
    },
    dispatch: vi.fn(),
  }
}

describe('TicketForm', () => {
  beforeEach(() => {
    mockUseProjects.mockReturnValue({
      data: [{
        id: 1,
        name: 'Acme Console',
        shortname: 'ACME',
        icon: '🧭',
        color: '#2563eb',
        folderPath: '/tmp/acme-console',
        profileId: null,
        councilMembers: null,
        maxIterations: null,
        perIterationTimeout: null,
        councilResponseTimeout: null,
        minCouncilQuorum: null,
        interviewQuestions: null,
        ticketCounter: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    })
    mockUseCreateTicket.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
    mockUseTicketAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  it('defaults the description view to Raw and previews Markdown on demand', () => {
    renderWithProviders(
      <UIContext.Provider value={makeUIValue()}>
        <TicketForm onClose={vi.fn()} />
      </UIContext.Provider>,
    )

    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('aria-selected', 'true')

    const textarea = screen.getByRole('textbox', { name: 'Ticket description' })
    fireEvent.change(textarea, { target: { value: '# Scope\nUse **bold** details.' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    expect(screen.getByRole('heading', { name: 'Scope' })).toBeInTheDocument()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })
})
