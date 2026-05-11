import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { beadsRouter } from '../beads'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-beads-route-',
  files: {
    'README.md': '# LoopTroop Beads Route Test\n',
  },
})

function createBeadsRouteTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'Beads Route',
    shortname: 'BEAD',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Validate beads',
    description: 'Regression coverage for beads flow validation.',
  })
  const paths = getTicketPaths(ticket.id)
  if (!paths) throw new Error('Expected ticket paths')
  return { ticket, paths }
}

describe('beadsRouter flow validation', () => {
  const app = new Hono()
  app.route('/api', beadsRouter)

  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('rejects traversal flows before reading or writing beads files', async () => {
    const { ticket, paths } = createBeadsRouteTicket()

    const getResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads?flow=../escape`)
    expect(getResponse.status).toBe(400)

    const putResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads?flow=../escape`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'B-1' }]),
    })
    expect(putResponse.status).toBe(400)
    expect(existsSync(join(paths.ticketDir, 'escape', '.beads', 'issues.jsonl'))).toBe(false)
  })
})
