import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { UIProvider } from '@/context/UIContext'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { KanbanBoard } from '../KanbanBoard'
import { renderWithProviders as sharedRenderWithProviders } from '@/test/renderHelpers'
import { TEST, makeTicket } from '@/test/factories'
import type { Ticket } from '@/hooks/useTickets'
import type { Project } from '@/hooks/useProjects'

const mockUseTickets = vi.hoisted(() => vi.fn())
const mockUseProjects = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useTickets', () => ({
  useTickets: () => mockUseTickets(),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
}))

function renderWithProviders(ui: React.ReactElement) {
  return sharedRenderWithProviders(<UIProvider>{ui}</UIProvider>)
}

function makeUIValue(search: string, dispatch = vi.fn()): UIContextValue {
  return {
    state: {
      selectedTicketId: null,
      selectedTicketExternalId: null,
      sidebarOpen: true,
      activeView: 'kanban',
      logPanelHeight: 300,
      filters: { projectId: null, status: null, search },
      theme: 'system',
    },
    dispatch,
  }
}

function renderWithSearch(search: string, dispatch = vi.fn()) {
  return sharedRenderWithProviders(
    <UIContext.Provider value={makeUIValue(search, dispatch)}>
      <KanbanBoard />
    </UIContext.Provider>,
  )
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: TEST.projectId,
    name: 'Test Project',
    shortname: TEST.shortname,
    icon: 'T',
    color: '#2563eb',
    folderPath: '/tmp/test-project',
    profileId: null,
    councilMembers: null,
    maxIterations: null,
    perIterationTimeout: null,
    executionSetupTimeout: null,
    councilResponseTimeout: null,
    minCouncilQuorum: null,
    interviewQuestions: null,
    ticketCounter: 1,
    createdAt: TEST.timestamp,
    updatedAt: TEST.timestamp,
    ...overrides,
  }
}

function mockBoardData(tickets: Ticket[], projects: Project[]) {
  mockUseTickets.mockReturnValue({ data: tickets, isLoading: false })
  mockUseProjects.mockReturnValue({ data: projects })
}

describe('KanbanBoard', () => {
  beforeEach(() => {
    mockBoardData([], [])
  })

  it('renders 4 columns', () => {
    renderWithProviders(<KanbanBoard />)
    const todo = screen.getByText('To Do')
    const needsInput = screen.getByText('Needs Input')
    const inProgress = screen.getByText('In Progress')
    const done = screen.getByText('Done')

    expect(todo).toBeInTheDocument()
    expect(needsInput).toBeInTheDocument()
    expect(inProgress).toBeInTheDocument()
    expect(done).toBeInTheDocument()
    expect(todo.compareDocumentPosition(needsInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(needsInput.compareDocumentPosition(inProgress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inProgress.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows "No tickets" in empty columns', () => {
    renderWithProviders(<KanbanBoard />)
    const noTickets = screen.getAllByText('No tickets')
    expect(noTickets.length).toBe(4)
  })

  it('shows correct column descriptions', () => {
    renderWithProviders(<KanbanBoard />)
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('Active workflow')).toBeInTheDocument()
    expect(screen.getByText('Waiting for user')).toBeInTheDocument()
    expect(screen.getByText('Completed tickets')).toBeInTheDocument()
  })

  it('filters rendered tickets and column counts by ticket ID compact matching', () => {
    const primaryProject = makeProject({ id: 1, name: 'Search Project', shortname: TEST.shortname })
    const secondaryProject = makeProject({ id: 2, name: 'Other Project', shortname: TEST.shortnameB })
    mockBoardData([
      makeTicket({
        id: `1:${TEST.shortname}-15`,
        externalId: `${TEST.shortname}-15`,
        title: 'Visible ticket',
        description: 'Description text is not used by dashboard search.',
        status: 'DRAFT',
        projectId: primaryProject.id,
      }),
      makeTicket({
        id: `1:${TEST.shortname}-16`,
        externalId: `${TEST.shortname}-16`,
        title: 'Other ticket',
        description: `${TEST.shortname}15 should not match from hidden ticket content.`,
        status: 'CODING',
        projectId: secondaryProject.id,
      }),
    ], [primaryProject, secondaryProject])

    renderWithSearch(`${TEST.shortname}15`)

    expect(screen.getByLabelText(`Open ticket ${TEST.shortname}-15`)).toBeInTheDocument()
    expect(screen.queryByLabelText(`Open ticket ${TEST.shortname}-16`)).not.toBeInTheDocument()
    expect(within(screen.getByText('To Do').parentElement as HTMLElement).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByText('In Progress').parentElement as HTMLElement).getByText('0')).toBeInTheDocument()
    expect(screen.getAllByText('No matching tickets')).toHaveLength(3)
  })

  it('shows a dashboard no-results state with a clear action', () => {
    const dispatch = vi.fn()
    mockBoardData([
      makeTicket({
        id: `1:${TEST.shortname}-18`,
        externalId: `${TEST.shortname}-18`,
        title: 'Visible ticket',
        status: 'DRAFT',
      }),
    ], [makeProject()])

    renderWithSearch('missing-ticket', dispatch)

    expect(screen.getByText('No tickets match this search.')).toBeInTheDocument()
    expect(screen.getAllByText('No matching tickets')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FILTER',
      filter: { search: '' },
    })
  })
})
