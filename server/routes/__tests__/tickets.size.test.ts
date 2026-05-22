import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'

vi.mock('../../workflow/runner', () => ({
  cancelTicket: vi.fn(),
  handleInterviewQABatch: vi.fn(),
  processInterviewBatchAsync: vi.fn(async () => undefined),
  skipAllInterviewQuestionsToApproval: vi.fn(),
}))

vi.mock('../../opencode/sessionManager', () => ({
  abortTicketSessions: vi.fn(async () => undefined),
}))

vi.mock('../../opencode/contextBuilder', () => ({
  clearContextCache: vi.fn(),
}))

vi.mock('../../machines/persistence', () => ({
  createTicketActor: vi.fn(),
  ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
  revertTicketToApprovalStatus: vi.fn(),
  sendTicketEvent: vi.fn(),
  getTicketState: vi.fn(() => null),
  stopActor: vi.fn(() => true),
}))

import { ticketRouter } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-route-size-',
  files: {
    'README.md': '# LoopTroop Ticket Route Size Test\n',
  },
})

describe('ticketRouter GET /tickets/:id/size', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('calculates the size of a ticket worktree path recursively', async () => {
    const repoDir = repoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop Size',
      shortname: 'SIZE',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Size route test',
      description: 'Checks size reporting.',
    })

    const init = initializeTicket({
      projectFolder: repoDir,
      externalId: ticket.externalId,
    })

    const app = new Hono()
    app.route('/api', ticketRouter)

    // Create some files under init.worktreePath to calculate size
    const file1 = join(init.worktreePath, 'test1.txt')
    const nestedDir = join(init.worktreePath, 'nested')
    const file2 = join(nestedDir, 'test2.txt')

    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(file1, 'hello') // 5 bytes
    writeFileSync(file2, 'world!') // 6 bytes

    const response = await app.request(`/api/tickets/${ticket.id}/size`)
    expect(response.status).toBe(200)

    const payload = await response.json() as { size: number; exists: boolean }
    expect(payload.exists).toBe(true)
    // The total size is at least 11 bytes plus whatever files git/initializeTicket created
    expect(payload.size).toBeGreaterThanOrEqual(11)
  })
})
