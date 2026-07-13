import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualQaRound } from '../useManualQA'

describe('useManualQaRound', () => {
  afterEach(() => vi.restoreAllMocks())

  it('normalizes durable operation state for resumable submission UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      version: 2,
      status: 'waiting',
      checklistHash: 'a'.repeat(64),
      checklist: { schemaVersion: 1, version: 2, items: [] },
      coverage: { entries: [] },
      evidence: [],
      draftRevision: 3,
      operation: {
        actionId: 'manual-qa-submit:resume-2',
        operationType: 'submit',
        state: 'creating_improvements',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useManualQaRound('ticket-1', 2), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.operation).toMatchObject({
      actionId: 'manual-qa-submit:resume-2',
      operationType: 'submit',
      state: 'creating_improvements',
      status: 'creating_improvements',
    })
  })

  it('preserves complete round summaries and coverage provenance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      version: 1,
      status: 'completed',
      checklistHash: 'b'.repeat(64),
      checklist: { schemaVersion: 1, version: 1, items: [] },
      coverage: {
        entries: [{ criterionRef: 'EP/ST/AC-1', criterion: 'The behavior works', status: 'covered', itemIds: ['item-1'] }],
        coveredCount: 1, partiallyCoveredCount: 0, uncoveredCount: 0,
        sourceItemCounts: { prd: 1, bead: 2, finalTest: 3, previousQa: 4, implementationDiff: 5 },
      },
      evidence: [],
      summary: {
        outcome: 'created_fixes', createdFixBeadIds: ['QA-1'], improvementTicketIds: ['APP-2'], waivedItemIds: ['item-1'], waivedItems: [{ itemId: 'item-1', reason: 'Device unavailable' }],
        startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:01:00.000Z', durationMs: 60_000,
        itemCounts: { pass: 1, fail: 1, waive: 1, improvement: 1, pending: 0 }, requiredItemCount: 2, optionalItemCount: 2, evidenceCount: 3,
        nextAction: 'return_to_coding', coverage: { covered: 1, partiallyCovered: 0, uncovered: 0 },
        modelCapability: { modelId: 'model', modelVariant: 'fast', capabilityLookup: 'available', supportsImages: true, imageEvidenceMode: 'attached' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useManualQaRound('ticket-1', 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.coverage[0]).toMatchObject({ criterion: 'The behavior works' })
    expect(result.current.data?.coverageSummary.sourceItemCounts).toEqual({ prd: 1, bead: 2, finalTest: 3, previousQa: 4, implementationDiff: 5 })
    expect(result.current.data?.summary).toMatchObject({
      createdFixBeadIds: ['QA-1'], improvementTicketIds: ['APP-2'], durationMs: 60_000,
      modelCapability: { imageEvidenceMode: 'attached' },
    })
  })
})
