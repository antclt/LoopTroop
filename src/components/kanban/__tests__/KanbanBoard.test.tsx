import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

function makeFilters(search = ''): UIContextValue['state']['filters'] {
  return {
    projectId: null,
    status: null,
    search,
    priority: null,
    stuckDays: null,
    onlyErrors: false,
    sortBy: 'updatedAt_desc',
  }
}

function makeUIValue(
  search: string,
  dispatch = vi.fn(),
  filterOverrides: Partial<UIContextValue['state']['filters']> = {},
): UIContextValue {
  return {
    state: {
      selectedTicketId: null,
      selectedTicketExternalId: null,
      sidebarOpen: true,
      activeView: 'kanban',
      logPanelHeight: 300,
      filters: { ...makeFilters(search), ...filterOverrides },
      theme: 'system',
      showTriageBar: false,
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

function renderWithFilters(filterOverrides: Partial<UIContextValue['state']['filters']>, dispatch = vi.fn()) {
  return sharedRenderWithProviders(
    <UIContext.Provider value={makeUIValue(filterOverrides.search ?? '', dispatch, filterOverrides)}>
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
    localStorage.clear()
    mockBoardData([], [])
  })

  afterEach(() => {
    vi.useRealTimers()
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
        description: 'Description text is also searchable.',
        status: 'DRAFT',
        projectId: primaryProject.id,
      }),
      makeTicket({
        id: `1:${TEST.shortname}-16`,
        externalId: `${TEST.shortname}-16`,
        title: 'Other ticket',
        description: `This other ticket description does not contain the query.`,
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

  it('shows the matched search field hint on cards', () => {
    const primaryProject = makeProject({ id: 1, name: 'Search Project', shortname: TEST.shortname })
    mockBoardData([
      makeTicket({
        id: `1:${TEST.shortname}-17`,
        externalId: `${TEST.shortname}-17`,
        title: 'Visible title',
        description: 'Hidden implementation detail',
        status: 'DRAFT',
        projectId: primaryProject.id,
      }),
    ], [primaryProject])

    renderWithSearch('hidden implementation')

    expect(screen.getByLabelText(`Open ticket ${TEST.shortname}-17`)).toBeInTheDocument()
    expect(screen.getByText('Description match')).toBeInTheDocument()
  })

  it('limits stale filtering to Needs Input and In Progress columns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'))

    mockBoardData([
      makeTicket({
        id: `1:${TEST.shortname}-20`,
        externalId: `${TEST.shortname}-20`,
        title: 'Stale needs input',
        status: 'WAITING_PRD_APPROVAL',
        updatedAt: '2026-06-25T12:00:00.000Z',
      }),
      makeTicket({
        id: `1:${TEST.shortname}-21`,
        externalId: `${TEST.shortname}-21`,
        title: 'Stale in progress',
        status: 'CODING',
        updatedAt: '2026-06-25T12:00:00.000Z',
      }),
      makeTicket({
        id: `1:${TEST.shortname}-22`,
        externalId: `${TEST.shortname}-22`,
        title: 'Old draft',
        status: 'DRAFT',
        updatedAt: '2026-06-25T12:00:00.000Z',
      }),
      makeTicket({
        id: `1:${TEST.shortname}-23`,
        externalId: `${TEST.shortname}-23`,
        title: 'Old done',
        status: 'COMPLETED',
        updatedAt: '2026-06-25T12:00:00.000Z',
      }),
    ], [makeProject()])

    renderWithFilters({ stuckDays: 1 })

    expect(screen.getByLabelText(`Open ticket ${TEST.shortname}-20`)).toBeInTheDocument()
    expect(screen.getByLabelText(`Open ticket ${TEST.shortname}-21`)).toBeInTheDocument()
    expect(screen.queryByLabelText(`Open ticket ${TEST.shortname}-22`)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`Open ticket ${TEST.shortname}-23`)).not.toBeInTheDocument()
    expect(within(screen.getByText('To Do').parentElement as HTMLElement).getByText('0')).toBeInTheDocument()
    expect(within(screen.getByText('Needs Input').parentElement as HTMLElement).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByText('In Progress').parentElement as HTMLElement).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByText('Done').parentElement as HTMLElement).getByText('0')).toBeInTheDocument()
  })

  it('shows saved preset details on hover', async () => {
    localStorage.setItem('looptroop-presets-global', JSON.stringify({
      'Night ops': {
        priority: [1, 2],
        stuckDays: 3,
        onlyErrors: true,
        sortBy: 'priority_asc',
      },
    }))

    const uiValueWithTriageOpen = makeUIValue('')
    uiValueWithTriageOpen.state.showTriageBar = true

    sharedRenderWithProviders(
      <UIContext.Provider value={uiValueWithTriageOpen}>
        <KanbanBoard />
      </UIContext.Provider>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: /presets/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.focus(await screen.findByRole('button', { name: 'Night ops' }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Priority: Very High, High')
    expect(tooltip).toHaveTextContent('Stale: > 3 days inactive')
    expect(tooltip).toHaveTextContent('Errors: Only blocked errors')
    expect(tooltip).toHaveTextContent('Sort: Priority (High to Low)')
  })

  it('saves a preset from the dropdown form with visible feedback', () => {
    const uiValueWithTriageOpen = makeUIValue('', vi.fn(), {
      priority: [1],
      stuckDays: 3,
      onlyErrors: true,
      sortBy: 'priority_asc',
    })
    uiValueWithTriageOpen.state.showTriageBar = true

    sharedRenderWithProviders(
      <UIContext.Provider value={uiValueWithTriageOpen}>
        <KanbanBoard />
      </UIContext.Provider>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: /presets/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.change(screen.getByPlaceholderText('New preset...'), {
      target: { value: 'Night ops' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Saved "Night ops"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Night ops' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('looptroop-presets-global') ?? '{}')).toMatchObject({
      'Night ops': {
        priority: [1],
        stuckDays: 3,
        onlyErrors: true,
        sortBy: 'priority_asc',
      },
    })
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
