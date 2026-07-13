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
  refetchRound: vi.fn(),
  includeDrift: vi.fn(),
  discardDrift: vi.fn(),
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
    useResolveManualQaDrift: (decision: 'include' | 'discard') => mutation(decision === 'include' ? mocks.includeDrift : mocks.discardDrift),
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
  coverageSummary: { coveredCount: 0, partiallyCoveredCount: 0, uncoveredCount: 0, sourceItemCounts: { prd: 0, bead: 0, finalTest: 0, previousQa: 0, implementationDiff: 0 } },
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
    mocks.refetchRound.mockResolvedValue({ data: round })
    mocks.round.mockReturnValue({ data: round, isLoading: false, error: null, refetch: mocks.refetchRound })
    mocks.save.mockResolvedValue({ conflict: false, revision: 1 })
    mocks.refetchUiState.mockResolvedValue({ data: { data: { results: {} }, revision: 2 } })
    mocks.submit.mockResolvedValue({})
    mocks.skip.mockResolvedValue({})
    mocks.remove.mockResolvedValue({ success: true })
    mocks.includeDrift.mockResolvedValue({ success: true })
    mocks.discardDrift.mockResolvedValue({ success: true })
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
      refetch: mocks.refetchRound,
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
      refetch: mocks.refetchRound,
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

    expect(await screen.findByText(/confirmed uploads remain linked/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit QA' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled())
    expect(mocks.submit.mock.calls[0]![0].draft.results[0].evidenceIds).toEqual(['evidence-1'])
  })

  it('reuses upload identities with refreshed CAS guards from the explicit retry state', async () => {
    mocks.upload.mockRejectedValue(new Error('connection lost'))
    mocks.refetchRound.mockResolvedValue({ data: { ...round, draftRevision: 7 } })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['same'], 'same.bin', { type: 'application/octet-stream', lastModified: 123 })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry upload' }))
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2))

    expect(mocks.upload.mock.calls[1]![0].actionId).toBe(mocks.upload.mock.calls[0]![0].actionId)
    expect(mocks.upload.mock.calls[1]![0].evidenceId).toBe(mocks.upload.mock.calls[0]![0].evidenceId)
    expect(mocks.upload.mock.calls[0]![0].expectedDraftRevision).toBe(0)
    expect(mocks.upload.mock.calls[1]![0].expectedDraftRevision).toBe(7)
  })

  it('assigns distinct identities to selected files with identical browser metadata', async () => {
    mocks.upload.mockRejectedValue(new Error('connection lost'))
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const first = new File(['aaaa'], 'same.bin', { type: 'application/octet-stream', lastModified: 123 })
    const second = new File(['bbbb'], 'same.bin', { type: 'application/octet-stream', lastModified: 123 })
    fireEvent.change(input, { target: { files: [first, second] } })
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2))

    expect(mocks.upload.mock.calls[1]![0].actionId).not.toBe(mocks.upload.mock.calls[0]![0].actionId)
    expect(mocks.upload.mock.calls[1]![0].evidenceId).not.toBe(mocks.upload.mock.calls[0]![0].evidenceId)
    expect(screen.getAllByRole('button', { name: 'Retry upload' })).toHaveLength(2)
  })

  it('shows removal failures and retries with the same action identity', async () => {
    const evidenceRound = { ...round, evidence: [{ id: 'evidence-1', itemId: 'item-1', name: 'screen.png', size: 10, sha256: 'a'.repeat(64), mediaType: 'image/png', previewable: true }] }
    mocks.round.mockReturnValue({ data: evidenceRound, isLoading: false, error: null, refetch: mocks.refetchRound })
    mocks.refetchRound.mockResolvedValue({ data: { ...evidenceRound, draftRevision: 8 } })
    mocks.remove.mockRejectedValue(new Error('connection lost'))
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove screen.png' }))
    expect(await screen.findByText(/same action identity with the latest draft revision/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove screen.png' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2))

    expect(mocks.remove.mock.calls[1]![0].actionId).toBe(mocks.remove.mock.calls[0]![0].actionId)
    expect(mocks.remove.mock.calls[0]![0].expectedDraftRevision).toBe(0)
    expect(mocks.remove.mock.calls[1]![0].expectedDraftRevision).toBe(8)
  })

  it('shows drift failures and retries the decision with the same action identity', async () => {
    const driftRound = { ...round, workspaceDrift: { detected: true, decisionRequired: true, files: [{ path: 'runtime.log' }] } }
    mocks.round.mockReturnValue({ data: driftRound, isLoading: false, error: null, refetch: mocks.refetchRound })
    mocks.refetchRound.mockResolvedValue({ data: { ...driftRound, draftRevision: 9 } })
    mocks.includeDrift.mockRejectedValue(new Error('connection lost'))
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Include in checkpoint' }))
    expect(await screen.findByText(/choose the same action to retry safely/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Include in checkpoint' }))
    await waitFor(() => expect(mocks.includeDrift).toHaveBeenCalledTimes(2))

    expect(mocks.includeDrift.mock.calls[1]![0].actionId).toBe(mocks.includeDrift.mock.calls[0]![0].actionId)
    expect(mocks.includeDrift.mock.calls[0]![0].expectedDraftRevision).toBe(0)
    expect(mocks.includeDrift.mock.calls[1]![0].expectedDraftRevision).toBe(9)
  })

  it('renders complete historical summary and coverage provenance', () => {
    mocks.round.mockReturnValue({
      data: {
        ...round,
        readOnly: true,
        outcome: 'waived_through',
        coverage: [{ criterionRef: 'EP-1/ST-1/AC-1', criterion: 'Checkout succeeds', status: 'covered', itemIds: ['item-1'] }],
        coverageSummary: { coveredCount: 1, partiallyCoveredCount: 0, uncoveredCount: 0, sourceItemCounts: { prd: 1, bead: 2, finalTest: 1, previousQa: 0, implementationDiff: 3 } },
        summary: {
          outcome: 'waived_through', createdFixBeadIds: ['QA-v1-1'], improvementTicketIds: ['APP-9'], waivedItemIds: ['item-1'], waivedItems: [{ itemId: 'item-1', reason: 'Unavailable device' }], durationMs: 65_000,
          itemCounts: { pass: 0, fail: 0, waive: 1, improvement: 0, pending: 0 }, requiredItemCount: 1, optionalItemCount: 0, evidenceCount: 2, nextAction: 'integrate', coverage: { covered: 1, partiallyCovered: 0, uncovered: 0 }, modelCapability: null,
        },
      },
      isLoading: false,
      error: null,
      refetch: mocks.refetchRound,
    })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} readOnly />)

    expect(screen.getByText('Round summary')).toBeInTheDocument()
    expect(screen.getByText(/1m 5s/)).toBeInTheDocument()
    expect(screen.getByText(/QA-v1-1/)).toBeInTheDocument()
    expect(screen.getByText(/APP-9/)).toBeInTheDocument()
    expect(screen.getByText('Checkout succeeds')).toBeInTheDocument()
    expect(screen.getByText('implementation diff: 3')).toBeInTheDocument()
  })

  it('renders checklist source counts when there are no PRD criteria', () => {
    mocks.round.mockReturnValue({
      data: { ...round, coverageSummary: { ...round.coverageSummary, sourceItemCounts: { ...round.coverageSummary.sourceItemCounts, implementationDiff: 2 } } },
      isLoading: false,
      error: null,
      refetch: mocks.refetchRound,
    })
    renderWithProviders(<ManualQAView ticket={waitingTicket()} />)

    expect(screen.getByText('PRD coverage')).toBeInTheDocument()
    expect(screen.getByText('implementation diff: 2')).toBeInTheDocument()
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
      refetch: mocks.refetchRound,
    }))

    renderWithProviders(<ManualQAView ticket={ticket} />)
    fireEvent.change(screen.getByLabelText('Open historical Manual QA round'), { target: { value: '1' } })

    expect(screen.getByText('Manual QA · Round v1')).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })
})
