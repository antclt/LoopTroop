import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/renderHelpers'
import { makeTicket } from '@/test/factories'
import type { ManualQaRound } from '@/hooks/useManualQA'

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  round: vi.fn(),
  save: vi.fn(),
  refetchUiState: vi.fn(),
  submit: vi.fn(),
  skip: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/hooks/useTickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useTickets')>()
  return {
    ...actual,
    useTicketUIState: () => ({
      data: { scope: 'manual_qa_draft:v1', exists: false, data: null, revision: 0, clientRevision: null, updatedAt: null },
      refetch: mocks.refetchUiState,
    }),
    useSaveTicketUIState: () => ({ mutateAsync: mocks.save }),
  }
})

vi.mock('@/hooks/useManualQA', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useManualQA')>()
  const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutate: fn, mutateAsync: fn, isPending: false })
  return {
    ...actual,
    useManualQaIndex: mocks.index,
    useManualQaRound: mocks.round,
    useSubmitManualQa: () => mutation(mocks.submit),
    useSkipManualQa: () => mutation(mocks.skip),
    useResolveManualQaDrift: () => mutation(vi.fn()),
    useUploadManualQaEvidence: () => mutation(mocks.upload),
    useRemoveManualQaEvidence: () => mutation(mocks.remove),
  }
})

import { ManualQAView } from '../ManualQAView'

const round: ManualQaRound = {
  version: 1,
  status: 'waiting',
  checklistHash: 'a'.repeat(64),
  checklist: {
    schemaVersion: 1,
    version: 1,
    items: [{
      id: 'item-1',
      lineageId: 'checkout',
      title: 'Submit checkout',
      required: true,
      source: 'prd',
      behavior: 'A valid checkout can be submitted.',
      severity: 'high',
      prerequisites: [],
      actions: ['Press submit.'],
      expectedResult: 'The order is confirmed.',
      prdRefs: [],
    }],
  },
  coverage: [],
  evidence: [],
  draftRevision: 0,
}

function waitingTicket() {
  return makeTicket({
    status: 'WAITING_MANUAL_QA',
    manualQa: {
      activeVersion: 1,
      completedRoundCount: 0,
      latestOutcome: null,
      artifactAvailability: { checklist: true, results: false, coverage: true, summary: false },
    },
  })
}

describe('ManualQAView recovery behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.index.mockReturnValue({
      data: { activeVersion: 1, completedRounds: 0, latestOutcome: null, artifactAvailable: true, versions: [{ version: 1, status: 'waiting' }] },
      isLoading: false,
      error: null,
    })
    mocks.round.mockReturnValue({ data: round, isLoading: false, error: null })
    mocks.save.mockResolvedValue({ conflict: false, revision: 1 })
    mocks.refetchUiState.mockResolvedValue({ data: { data: { results: {} }, revision: 2 } })
    mocks.submit.mockResolvedValue({})
    mocks.skip.mockResolvedValue({})
    mocks.remove.mockResolvedValue({ success: true })
  })

  afterEach(() => cleanup())

  it('blocks submission after an autosave conflict and offers an explicit reload', async () => {
    mocks.save.mockResolvedValueOnce({ conflict: true, revision: 2, data: { results: {} } })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit QA' }))

    expect(await screen.findByText(/newer draft exists/i)).toBeInTheDocument()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /reload latest draft/i })).toBeInTheDocument()
  })

  it('reuses the server journal action ID when resuming a partial submission', async () => {
    mocks.round.mockReturnValue({
      data: {
        ...round,
        draft: { results: { 'item-1': { itemId: 'item-1', status: 'pass' } } },
        operation: { actionId: 'manual-qa-submit:resume-1', state: 'creating_beads', status: 'creating_beads' },
      },
      isLoading: false,
      error: null,
    })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    expect(screen.getByRole('button', { name: 'Pass' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip Manual QA' })).toBeDisabled()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resume submission' }))

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled())
    expect(mocks.submit.mock.calls[0]![0].actionId).toBe('manual-qa-submit:resume-1')
    expect(screen.getByText(/Submission operation: creating beads.*Editing and Skip are locked/i)).toBeInTheDocument()
  })

  it('resumes a partial skip with its journal action instead of starting submit', async () => {
    mocks.round.mockReturnValue({
      data: {
        ...round,
        draft: { results: { 'item-1': { itemId: 'item-1', status: 'pending' } }, skipReason: 'Already checked.' },
        operation: { actionId: 'manual-qa-skip:resume-1', operationType: 'skip', state: 'staged', status: 'staged' },
      },
      isLoading: false,
      error: null,
    })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resume skip' }))

    await waitFor(() => expect(mocks.skip).toHaveBeenCalled())
    expect(mocks.skip.mock.calls[0]![0].actionId).toBe('manual-qa-skip:resume-1')
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps each successful file linked when a later upload fails', async () => {
    mocks.upload
      .mockResolvedValueOnce({ id: 'evidence-1', itemId: 'item-1', name: 'first.png' })
      .mockRejectedValueOnce(new Error('too large'))
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.bin', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [first, second] } })

    expect(await screen.findByText(/successfully uploaded files remain linked/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit QA' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled())
    expect(mocks.submit.mock.calls[0]![0].draft.results[0].evidenceIds).toEqual(['evidence-1'])
  })

  it('allows a previous round to be opened while the next checklist generates', () => {
    const ticket = makeTicket({
      status: 'GENERATING_QA_CHECKLIST',
      manualQa: {
        activeVersion: 2,
        completedRoundCount: 1,
        latestOutcome: 'created_fixes',
        artifactAvailability: { checklist: true, results: true, coverage: true, summary: true },
      },
    })
    mocks.index.mockReturnValue({
      data: {
        activeVersion: 2,
        completedRounds: 1,
        latestOutcome: 'created_fixes',
        artifactAvailable: true,
        versions: [{ version: 1, status: 'completed', outcome: 'created_fixes' }, { version: 2, status: 'generating' }],
      },
      isLoading: false,
      error: null,
    })
    mocks.round.mockImplementation((_ticketId: string, version: number) => ({
      data: version === 1 ? { ...round, readOnly: true, outcome: 'created_fixes' } : undefined,
      isLoading: false,
      error: null,
    }))

    renderWithProviders(<ManualQAView ticket={ticket} />)
    fireEvent.change(screen.getByLabelText('Open historical Manual QA round'), { target: { value: '1' } })

    expect(screen.getByText('Manual QA · Round v1')).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })
})
