import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { OpenCodeCatalogModel } from '@shared/opencodeCatalog'
import { MODEL_FETCH_TIMEOUT_MS, QUERY_STALE_TIME_5M, OPENCODE_RETRY_COUNT, SSE_RECONNECT_DELAY_MS } from '@/lib/constants'

export interface ModelsApiResponse {
  models: OpenCodeCatalogModel[]
  connectedProviders: string[]
  defaultModels: Record<string, string>
  message?: string
}

export type OpenCodeModel = OpenCodeCatalogModel
export const OPENCODE_MODELS_QUERY_KEY = ['opencode-models', 'connected'] as const
export const ALL_OPENCODE_MODELS_QUERY_KEY = ['opencode-models', 'all'] as const

async function requestModelsApi(path: string, method: 'GET' | 'POST'): Promise<ModelsApiResponse> {
  const res = await fetch(path, { method, signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error('Failed to fetch models')
  const data: ModelsApiResponse = await res.json()
  // When the backend cannot reach OpenCode it returns a `message` with an empty
  // model list (HTTP 200). Treat this as a retriable error so react-query retries
  // during the startup window while OpenCode is still initialising.
  if (data.message) throw new Error(data.message)
  return data
}

export function fetchModelsApi(): Promise<ModelsApiResponse> {
  return requestModelsApi('/api/models', 'GET')
}

export function fetchAllModelsApi(): Promise<ModelsApiResponse> {
  return requestModelsApi('/api/models?scope=all', 'GET')
}

export function refreshModelsApi(): Promise<ModelsApiResponse> {
  return requestModelsApi('/api/models/refresh', 'POST')
}

export function clearOpenCodeModelsQuery(queryClient: Pick<QueryClient, 'removeQueries'>) {
  queryClient.removeQueries({
    queryKey: ['opencode-models'],
  })
}

export function refreshOpenCodeModelsQuery(queryClient: Pick<QueryClient, 'removeQueries' | 'fetchQuery'>) {
  clearOpenCodeModelsQuery(queryClient)
  return queryClient.fetchQuery({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    queryFn: refreshModelsApi,
    staleTime: QUERY_STALE_TIME_5M,
  })
}

export function refetchOpenCodeModelsQuery(queryClient: Pick<QueryClient, 'refetchQueries'>) {
  return queryClient.refetchQueries({
    queryKey: ['opencode-models'],
    type: 'active',
  })
}

/** Returns only models from connected (configured) providers */
export function useOpenCodeModels() {
  return useQuery({
    queryKey: OPENCODE_MODELS_QUERY_KEY,
    queryFn: fetchModelsApi,
    staleTime: QUERY_STALE_TIME_5M,
    retry: OPENCODE_RETRY_COUNT,
    retryDelay: SSE_RECONNECT_DELAY_MS,
    select: (data) => data.models,
  })
}

/** Returns all models from all providers only when explicitly requested. */
export function useAllOpenCodeModels(enabled = false) {
  return useQuery({
    queryKey: ALL_OPENCODE_MODELS_QUERY_KEY,
    queryFn: fetchAllModelsApi,
    staleTime: QUERY_STALE_TIME_5M,
    retry: OPENCODE_RETRY_COUNT,
    retryDelay: SSE_RECONNECT_DELAY_MS,
    select: (data) => data.models,
    enabled,
  })
}
