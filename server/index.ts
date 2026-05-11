import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { startupSequence } from './startup'
import { health } from './routes/health'
import { profileRouter } from './routes/profiles'
import { projectRouter } from './routes/projects'
import { ticketRouter } from './routes/tickets'
import { streamRouter } from './routes/stream'
import { modelsRouter } from './routes/models'
import { filesRouter } from './routes/files'
import { beadsRouter } from './routes/beads'
import { validateJson } from './middleware/validation'
import { getBackendPort, getFrontendOrigin } from '../shared/appConfig'
import { workflowRouter } from './routes/workflow'
import { startUpsertBuffer, stopUpsertBuffer } from './log/upsertBuffer'
import { createApiRateLimitMiddleware } from './middleware/rateLimit'

const app = new Hono()

function isLocalhostRequest(c: Context): boolean {
  const host = c.req.header('Host')?.trim().toLowerCase()
  if (!host) {
    return false
  }

  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0]

  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

// Global middleware
// Chrome's Private Network Access enforcement requires this header on OPTIONS preflights
// when the browser (localhost:5173) accesses another port (localhost:3000).
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' && c.req.header('Access-Control-Request-Private-Network') === 'true') {
    c.header('Access-Control-Allow-Private-Network', 'true')
  }
  await next()
})
app.use('/api/*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')

  if (!isLocalhostRequest(c)) {
    c.header('Strict-Transport-Security', 'max-age=31536000')
  }

  await next()
})
app.use('/api/*', cors({
  origin: getFrontendOrigin(),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // Cache-Control is required for EventSource (browser sends Cache-Control: no-cache in CORS preflight)
  allowHeaders: ['Content-Type', 'Last-Event-ID', 'Cache-Control'],
}))
app.use('/api/*', createApiRateLimitMiddleware())
app.use('/api/*', validateJson)

// Mount routes
app.route('/api', health)
app.route('/api', profileRouter)
app.route('/api', projectRouter)
app.route('/api', ticketRouter)
app.route('/api', streamRouter)
app.route('/api', modelsRouter)
app.route('/api', filesRouter)
app.route('/api', beadsRouter)
app.route('/api', workflowRouter)

process.on('SIGTERM', () => stopUpsertBuffer())
process.on('SIGINT', () => stopUpsertBuffer())

const port = getBackendPort()

async function startServer(): Promise<void> {
  console.log(`[server] LoopTroop backend starting on port ${port}`)
  await startupSequence()
  startUpsertBuffer()
  serve({ fetch: app.fetch, port })
  console.log(`[server] LoopTroop backend running on http://localhost:${port}`)
}

void startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[server] LoopTroop backend failed to start: ${message}`)
  process.exit(1)
})

export default app
export { app }
