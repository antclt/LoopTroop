import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths, patchTicket } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { beadsRouter } from '../beads'
import { contentSha256 } from '../../lib/contentHash'

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

    patchTicket(ticket.id, { status: 'WAITING_BEADS_APPROVAL' })
    const putResponse = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads?flow=../escape`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'B-1' }]),
    })
    expect(putResponse.status).toBe(400)
    expect(existsSync(join(paths.ticketDir, 'escape', '.beads', 'issues.jsonl'))).toBe(false)
  })

  it('rejects beads edits outside WAITING_BEADS_APPROVAL', async () => {
    const { ticket, paths } = createBeadsRouteTicket()

    const response = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'B-1', title: 'Blocked edit' }]),
    })

    expect(response.status).toBe(409)
    expect(existsSync(paths.beadsPath)).toBe(false)
    expect(getLatestPhaseArtifact(ticket.id, 'user_edit_receipt:beads', 'WAITING_BEADS_APPROVAL')).toBeUndefined()
  })

  it('writes a user edit receipt when beads are saved during approval', async () => {
    const { ticket } = createBeadsRouteTicket()
    patchTicket(ticket.id, { status: 'WAITING_BEADS_APPROVAL' })
    const beads = [
      {
        id: 'B-1',
        title: 'Editable bead',
        status: 'pending',
        priority: 1,
        dependencies: { blocked_by: [], blocks: [] },
      },
    ]
    const raw = `${beads.map((item) => JSON.stringify(item)).join('\n')}\n`

    const response = await app.request(`/api/tickets/${encodeURIComponent(ticket.id)}/beads`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(beads),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Content-Sha256')).toBe(contentSha256(raw))
    const receipt = getLatestPhaseArtifact(ticket.id, 'user_edit_receipt:beads', 'WAITING_BEADS_APPROVAL')
    expect(receipt).toBeDefined()
    const data = JSON.parse(receipt!.content)
    expect(data).toMatchObject({
      target_artifact: 'beads',
      action: 'save',
      edit_surface: 'structured',
      before: {
        sha256: null,
        item_count: null,
      },
      after: {
        sha256: contentSha256(raw),
        item_count: 1,
      },
    })
  })
})
