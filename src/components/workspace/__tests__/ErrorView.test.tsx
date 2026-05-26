import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import { ErrorView } from '../ErrorView'
import { BEAD_RETRY_BUDGET_EXHAUSTED } from '@shared/errorCodes'
import {
  FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
  FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
} from '@shared/finalTestFileEffects'

const logSectionMock = vi.hoisted(() => vi.fn(() => <div data-testid="phase-log-section" />))
const mockUseTicketAction = vi.hoisted(() => vi.fn())

vi.mock('../CollapsiblePhaseLogSection', () => ({
  CollapsiblePhaseLogSection: logSectionMock,
}))

vi.mock('@/hooks/useTickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useTickets')>()
  return {
    ...actual,
    useTicketAction: () => mockUseTicketAction(),
  }
})

describe('ErrorView', () => {
  beforeEach(() => {
    logSectionMock.mockClear()
    mockUseTicketAction.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('allows long error details to scroll within the summary area', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      errorMessage: 'A'.repeat(4000),
      availableActions: ['retry', 'cancel'],
    })

    const { container } = renderWithProviders(<ErrorView ticket={ticket} />)
    const root = container.firstElementChild as HTMLElement
    const summary = root.firstElementChild as HTMLElement

    expect(root).toHaveClass('min-h-0')
    expect(summary).toHaveClass('min-h-0', 'shrink', 'overflow-y-auto')
    expect(screen.getByTestId('phase-log-section')).toBeInTheDocument()
  })

  it('starts the error log drawer collapsed at the bottom', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    const firstLogSectionProps = (logSectionMock.mock.calls[0] as [unknown] | undefined)?.[0]
    expect(firstLogSectionProps).toMatchObject({
      phase: 'CODING',
      defaultExpanded: false,
    })
  })

  it('shows a coding-specific retry label when the active error exhausted the bead retry budget', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: '1',
      errorOccurrences: [{
        id: '1',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'Bead used its retry budget.',
        errorCodes: [BEAD_RETRY_BUDGET_EXHAUSTED],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        maxIterationsPerBead: 5,
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByRole('button', { name: 'Try again 5 retries' })).toBeInTheDocument()
  })

  it('keeps the generic retry label for non-budget blocked errors', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: '2',
      errorOccurrences: [{
        id: '2',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'Lint failed.',
        errorCodes: ['LINT_FAILED'],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        maxIterationsPerBead: 5,
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows real bead counters on coding error occurrence labels', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: 'bead-counts',
      errorOccurrences: [{
        id: 'bead-counts',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'Bead execution failed.',
        errorCodes: [],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        currentBead: 2,
        totalBeads: 5,
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByText('Error 1 — Implementing (Bead 2/5)')).toBeInTheDocument()
    expect(screen.getByText('Blocked from Implementing (Bead 2/5)')).toBeInTheDocument()
    expect(screen.queryByText(/Bead \?\/\?/)).not.toBeInTheDocument()
  })

  it('shows Continue only when the live blocked ticket exposes the continue action', () => {
    const mutate = vi.fn()
    mockUseTicketAction.mockReturnValue({ mutate, isPending: false })
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'PREPARING_EXECUTION_ENV',
      availableActions: ['retry', 'continue', 'cancel'],
      activeErrorOccurrenceId: 'continue-1',
      errorOccurrences: [{
        id: 'continue-1',
        occurrenceNumber: 1,
        blockedFromStatus: 'PREPARING_EXECUTION_ENV',
        errorMessage: 'Usage limit reached.',
        errorCodes: [],
        diagnostics: {
          kind: 'opencode_provider',
          source: 'provider',
          summary: 'usage limit reached',
          sessionId: 'ses-continue',
          statusCode: 429,
          isRetryable: true,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/sends only "continue please"/i)).toBeInTheDocument()
    expect(mutate).toHaveBeenCalledWith(
      { id: ticket.id, action: 'continue' },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('shows a paused coding bead cue for continuable provider interruptions', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'CODING',
      availableActions: ['retry', 'continue', 'cancel'],
      activeErrorOccurrenceId: 'coding-paused',
      errorOccurrences: [{
        id: 'coding-paused',
        occurrenceNumber: 1,
        blockedFromStatus: 'CODING',
        errorMessage: 'OpenCode retry grace window expired.',
        errorCodes: ['OPENCODE_PROVIDER_ERROR'],
        diagnostics: {
          kind: 'opencode_provider',
          source: 'provider',
          summary: 'usage limit reached',
          sessionId: 'ses-coding',
          statusCode: 429,
          isRetryable: true,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
      runtime: {
        ...makeTicket().runtime,
        activeBeadId: 'bead-9',
        activeBeadIteration: 6,
        beads: [{
          id: 'bead-9',
          title: 'Provider-limited bead',
          status: 'in_progress',
          iteration: 6,
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
        }],
      },
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('bead-9')).toBeInTheDocument()
    expect(screen.getByText(/Timer paused while the ticket is blocked/)).toHaveTextContent(
      'Continue resumes the preserved OpenCode session with a fresh bead timer.',
    )
    expect(screen.queryByText(/Failed bead/)).not.toBeInTheDocument()
  })

  it('shows action errors inline when Continue is rejected', async () => {
    const mutate = vi.fn((_: unknown, options?: { onError?: (error: Error) => void }) => {
      options?.onError?.(new Error('Continue is not available because the preserved OpenCode session is no longer active'))
    })
    mockUseTicketAction.mockReturnValue({ mutate, isPending: false })
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'PREPARING_EXECUTION_ENV',
      availableActions: ['retry', 'continue', 'cancel'],
      activeErrorOccurrenceId: 'continue-rejected',
      errorOccurrences: [{
        id: 'continue-rejected',
        occurrenceNumber: 1,
        blockedFromStatus: 'PREPARING_EXECUTION_ENV',
        errorMessage: 'Usage limit reached.',
        errorCodes: [],
        diagnostics: {
          kind: 'opencode_provider',
          source: 'provider',
          summary: 'usage limit reached',
          sessionId: 'ses-continue',
          statusCode: 429,
          isRetryable: true,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Continue is not available because the preserved OpenCode session is no longer active')
  })

  it('hides Continue when the live blocked ticket does not expose the continue action', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'PREPARING_EXECUTION_ENV',
      availableActions: ['retry', 'cancel'],
      activeErrorOccurrenceId: 'retry-only',
      errorOccurrences: [{
        id: 'retry-only',
        occurrenceNumber: 1,
        blockedFromStatus: 'PREPARING_EXECUTION_ENV',
        errorMessage: 'Invalid request.',
        errorCodes: [],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('shows final-test file effect recovery actions when exposed by the blocked ticket', () => {
    const mutate = vi.fn()
    mockUseTicketAction.mockReturnValue({ mutate, isPending: false })
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'INTEGRATING_CHANGES',
      availableActions: ['retry', FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION, FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION, 'cancel'],
      activeErrorOccurrenceId: 'file-effects',
      errorOccurrences: [{
        id: 'file-effects',
        occurrenceNumber: 1,
        blockedFromStatus: 'INTEGRATING_CHANGES',
        errorMessage: 'Final testing left unclassified dirty file(s): tmp/output.log',
        errorCodes: ['FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED'],
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)
    fireEvent.click(screen.getByRole('button', { name: 'Include in PR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard and Continue' }))

    expect(mutate).toHaveBeenCalledWith(
      { id: ticket.id, action: FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
    expect(mutate).toHaveBeenCalledWith(
      { id: ticket.id, action: FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('renders structured blocked-error diagnostics when present', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'SCANNING_RELEVANT_FILES',
      activeErrorOccurrenceId: 'diag-1',
      errorOccurrences: [{
        id: 'diag-1',
        occurrenceNumber: 1,
        blockedFromStatus: 'SCANNING_RELEVANT_FILES',
        errorMessage: 'Relevant files scan failed validation after 1 structured retry attempt(s).',
        errorCodes: ['RELEVANT_FILES_SCAN_FAILED', 'OPENCODE_PROVIDER_AUTH_FAILED'],
        diagnostics: {
          kind: 'opencode_provider',
          source: 'provider',
          summary: 'invalid_request_error: Your authentication token has been invalidated. Please try signing in again. (HTTP 401)',
          modelId: 'openai/gpt-5.3-codex',
          sessionId: 'ses-auth',
          providerId: 'openai',
          providerModelId: 'gpt-5.3-codex',
          statusCode: 401,
          providerErrorType: 'invalid_request_error',
          providerErrorMessage: 'Your authentication token has been invalidated. Please try signing in again.',
          isRetryable: false,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByText('Underlying error')).toBeInTheDocument()
    expect(screen.getByText(/invalid_request_error: Your authentication token has been invalidated/)).toBeInTheDocument()
    expect(screen.getByText('HTTP:')).toBeInTheDocument()
    expect(screen.getByText('401')).toBeInTheDocument()
    expect(screen.getByText('Provider:')).toBeInTheDocument()
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('Provider model:')).toBeInTheDocument()
    expect(screen.getByText('Provider type:')).toBeInTheDocument()
    expect(screen.getByText('invalid_request_error')).toBeInTheDocument()
    expect(screen.getByText('Retryable:')).toBeInTheDocument()
    expect(screen.getByText('no')).toBeInTheDocument()
  })

  it('renders model output truncation diagnostics with finish reason and token counts', () => {
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'VERIFYING_PRD_COVERAGE',
      activeErrorOccurrenceId: 'diag-length',
      errorOccurrences: [{
        id: 'diag-length',
        occurrenceNumber: 1,
        blockedFromStatus: 'VERIFYING_PRD_COVERAGE',
        errorMessage: 'PRD coverage resolution output failed validation after 1 structured retry attempt(s): PRD is missing epics',
        errorCodes: ['COVERAGE_FAILED', 'OPENCODE_OUTPUT_TRUNCATED'],
        diagnostics: {
          kind: 'model_output_truncated',
          source: 'opencode',
          summary: 'The model stopped because OpenCode reported finish reason "length", which usually means the response reached the model or provider output length limit.',
          modelId: 'opencode-go/deepseek-v4-flash',
          sessionId: 'ses-length',
          finishReason: 'length',
          outputTokens: 2923,
          reasoningTokens: 29077,
          inputTokens: 13252,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByText('Underlying error')).toBeInTheDocument()
    expect(screen.getByText('Model Output Truncated')).toBeInTheDocument()
    expect(screen.getByText('Finish reason:')).toBeInTheDocument()
    expect(screen.getByText('length')).toBeInTheDocument()
    expect(screen.getByText('Output tokens:')).toBeInTheDocument()
    expect(screen.getByText('2,923')).toBeInTheDocument()
    expect(screen.getByText('Reasoning tokens:')).toBeInTheDocument()
    expect(screen.getByText('29,077')).toBeInTheDocument()
  })

  it('does not repeat the diagnostic summary when it already appears in the primary error', () => {
    const duplicateMessage = 'Coverage output failed validation after 1 structured retry attempt(s): No coverage result content found'
    const ticket = makeTicket({
      status: 'BLOCKED_ERROR',
      previousStatus: 'VERIFYING_PRD_COVERAGE',
      activeErrorOccurrenceId: 'diag-duplicate',
      errorOccurrences: [{
        id: 'diag-duplicate',
        occurrenceNumber: 1,
        blockedFromStatus: 'VERIFYING_PRD_COVERAGE',
        errorMessage: duplicateMessage,
        errorCodes: ['COVERAGE_FAILED'],
        diagnostics: {
          kind: 'runtime',
          source: 'opencode',
          summary: duplicateMessage,
        },
        occurredAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolutionStatus: null,
        resumedToStatus: null,
      }],
    })

    renderWithProviders(<ErrorView ticket={ticket} />)

    expect(screen.getByText('Underlying error')).toBeInTheDocument()
    expect(screen.getAllByText(duplicateMessage)).toHaveLength(1)
    expect(screen.getByText('Kind:')).toBeInTheDocument()
    expect(screen.getByText('Runtime')).toBeInTheDocument()
  })

  it('omits milliseconds from occurrence timestamps', () => {
    const occurrence = {
      id: '3',
      occurrenceNumber: 1,
      blockedFromStatus: 'CODING',
      errorMessage: 'Workspace setup timed out.',
      errorCodes: [],
      occurredAt: '2026-01-01T00:00:00.123Z',
      resolvedAt: '2026-01-01T00:01:00.456Z',
      resolutionStatus: 'RETRIED' as const,
      resumedToStatus: 'WAITING_EXECUTION_SETUP_APPROVAL',
    }
    const ticket = makeTicket({
      status: 'CANCELED',
      previousStatus: 'BLOCKED_ERROR',
      errorOccurrences: [occurrence],
      activeErrorOccurrenceId: null,
    })

    renderWithProviders(<ErrorView ticket={ticket} occurrence={occurrence} readOnly />)

    const blockedLabel = screen.getByText(/Blocked from /)
    expect(blockedLabel).toHaveAttribute('title')
    expect(blockedLabel.getAttribute('title')).not.toContain('.123')

    const resolvedLabel = screen.getByText(/Resolved /)
    expect(resolvedLabel).not.toHaveTextContent('.456')
  })
})
