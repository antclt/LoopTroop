import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { ticketRouter } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-ui-state-route-',
  files: {
    'README.md': '# LoopTroop Ticket UI State Route Test\n',
  },
})

function createUiStateTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'UI State Route',
    shortname: 'UI',
  })
  return createTicket({
    projectId: project.id,
    title: 'Persist UI state',
    description: 'Regression coverage for UI state revisions.',
  })
}

describe('ticketRouter UI state revisions', () => {
  const app = new Hono()
  app.route('/api', ticketRouter)

  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('ignores stale client revisions so old autosaves cannot overwrite newer state', async () => {
    const ticket = createUiStateTicket()
    const path = `/api/tickets/${encodeURIComponent(ticket.id)}/ui-state`

    const newer = await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'workspace', data: { selected: 'newer' }, clientRevision: 2 }),
    })
    expect(newer.status).toBe(200)

    const stale = await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'workspace', data: { selected: 'stale' }, clientRevision: 1 }),
    })
    expect(stale.status).toBe(200)
    expect(await stale.json()).toMatchObject({ ignored: true, clientRevision: 2 })

    const response = await app.request(`${path}?scope=workspace`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { selected: 'newer' },
      clientRevision: 2,
    })
  })

  it('keeps the dev-event endpoint disabled unless explicitly configured', async () => {
    const previousEnabled = process.env.LOOPTROOP_ENABLE_DEV_EVENT
    const previousToken = process.env.LOOPTROOP_DEV_EVENT_TOKEN
    delete process.env.LOOPTROOP_ENABLE_DEV_EVENT
    delete process.env.LOOPTROOP_DEV_EVENT_TOKEN

    try {
      const ticket = createUiStateTicket()
      const response = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/dev-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'READY' }),
      })

      expect(response.status).toBe(404)
    } finally {
      if (previousEnabled === undefined) delete process.env.LOOPTROOP_ENABLE_DEV_EVENT
      else process.env.LOOPTROOP_ENABLE_DEV_EVENT = previousEnabled
      if (previousToken === undefined) delete process.env.LOOPTROOP_DEV_EVENT_TOKEN
      else process.env.LOOPTROOP_DEV_EVENT_TOKEN = previousToken
    }
  })

  it('exposes an aggregate OpenCode questions endpoint', async () => {
    const response = await app.request('/api/opencode/questions')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ questions: [] })
  })
})
