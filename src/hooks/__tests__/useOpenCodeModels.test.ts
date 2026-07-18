import { createElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createTestQueryClient } from '@/test/renderHelpers'
import {
  ALL_OPENCODE_MODELS_QUERY_KEY,
  clearOpenCodeModelsQuery,
  fetchAllModelsApi,
  fetchModelsApi,
  OPENCODE_MODELS_QUERY_KEY,
  refreshOpenCodeModelsQuery,
  useAllOpenCodeModels,
  useOpenCodeModels,
} from '../useOpenCodeModels'

function Probe() {
  useOpenCodeModels()
  useAllOpenCodeModels()
  return createElement('div')
}

describe('useOpenCodeModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ fullId: 'openai/gpt-5.3-codex' }],
        connectedProviders: ['openai'],
        defaultModels: {},
      }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches connected models without requesting the full catalog', async () => {
    const queryClient = createTestQueryClient()

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe),
      ),
    )

    await waitFor(() => {
      expect(queryClient.getQueryData(OPENCODE_MODELS_QUERY_KEY)).toEqual({
        models: [{ fullId: 'openai/gpt-5.3-codex' }],
        connectedProviders: ['openai'],
        defaultModels: {},
      })
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/models', { method: 'GET', signal: expect.any(AbortSignal) })
    expect(queryClient.getQueryData(ALL_OPENCODE_MODELS_QUERY_KEY)).toBeUndefined()
  })

  it('requests the full catalog from its separate endpoint scope', async () => {
    await fetchAllModelsApi()

    expect(fetch).toHaveBeenCalledWith('/api/models?scope=all', {
      method: 'GET',
      signal: expect.any(AbortSignal),
    })
  })

  it('treats a response with a message field as an error (opencode not ready)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [],
        connectedProviders: [],
        defaultModels: {},
        message: 'OpenCode server is not reachable. Start it with `opencode serve`.',
      }),
    })))

    await expect(fetchModelsApi()).rejects.toThrow(/not reachable/i)
  })

  it('clears the cached models query before configuration opens', () => {
    const removeQueries = vi.fn()

    clearOpenCodeModelsQuery({ removeQueries })

    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ['opencode-models'],
    })
  })

  it('clears and refreshes models through the strong refresh endpoint', async () => {
    const queryClient = createTestQueryClient()

    await refreshOpenCodeModelsQuery(queryClient)

    expect(fetch).toHaveBeenCalledWith('/api/models/refresh', {
      method: 'POST',
      signal: expect.any(AbortSignal),
    })
    expect(queryClient.getQueryData(OPENCODE_MODELS_QUERY_KEY)).toEqual(expect.objectContaining({
      connectedProviders: ['openai'],
    }))
  })
})
