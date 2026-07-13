import { Hono } from 'hono'
import { getOpenCodeAdapter } from '../opencode/factory'
import { fetchProviderCatalog, flattenCatalogModels, refreshProviderCatalog } from '../opencode/providerCatalog'
import type { OpenCodeCatalogResponse } from '../../shared/opencodeCatalog'

const modelsRouter = new Hono()

function serializeCatalog(catalog: OpenCodeCatalogResponse) {
  return {
    models: flattenCatalogModels(catalog, 'connected'),
    allModels: flattenCatalogModels(catalog, 'all'),
    connectedProviders: catalog.connected,
    defaultModels: catalog.default,
  }
}

async function modelDiscoveryFailure() {
  const adapter = getOpenCodeAdapter()
  const health = await adapter.checkHealth()
  return {
    models: [],
    allModels: [],
    connectedProviders: [],
    defaultModels: {},
    message: health.available
      ? 'OpenCode is connected, but model discovery failed.'
      : 'OpenCode server is not reachable. Start it with `opencode serve`.',
  }
}

modelsRouter.get('/models', async (c) => {
  try {
    return c.json(serializeCatalog(await fetchProviderCatalog()))
  } catch {
    return c.json(await modelDiscoveryFailure())
  }
})

modelsRouter.post('/models/refresh', async (c) => {
  try {
    return c.json(serializeCatalog(await refreshProviderCatalog()))
  } catch {
    return c.json(await modelDiscoveryFailure())
  }
})

export { modelsRouter }
