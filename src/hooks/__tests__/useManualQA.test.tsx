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
})
