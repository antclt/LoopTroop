import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  ensureActivePhaseAttempt,
  getTicketByRef,
  listPhaseArtifacts,
  listPhaseAttempts,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'

vi.mock('../../machines/persistence', async () => {
  const storage = await import('../../storage/tickets')

  return {
    createTicketActor: vi.fn(),
    ensureActorForTicket: vi.fn(() => ({ id: 'mock-actor' })),
    sendTicketEvent: vi.fn((ticketRef: string | number, event: { type: string }) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (event.type === 'RETRY' && ticket?.previousStatus) {
        storage.patchTicket(String(ticketRef), {
          status: ticket.previousStatus,
          errorMessage: null,
        })
      }
      return { value: event.type }
    }),
    getTicketState: vi.fn((ticketRef: string | number) => {
      const ticket = storage.getTicketByRef(String(ticketRef))
      if (!ticket) return null
      return { state: ticket.status, context: {}, status: 'active' }
    }),
    stopActor: vi.fn(() => true),
    revertTicketToApprovalStatus: vi.fn(),
  }
})

vi.mock('../../workflow/phases/beadsPhase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workflow/phases/beadsPhase')>()
  return {
    ...actual,
    recoverCodingBeadWithReset: vi.fn(() => ({ id: 'B1' })),
  }
})

import { sendTicketEvent } from '../../machines/persistence'
import { recoverCodingBeadWithReset } from '../../workflow/phases/beadsPhase'
import { ticketRouter } from '../tickets'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-retry-route-',
  files: {
    'README.md': '# Retry route test\n',
  },
})

function setupRetryTicketApp() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Retry route',
    description: 'Verify retry attempt history.',
  })

  const app = new Hono()
  app.route('/api', ticketRouter)

  return { app, ticket }
}

describe('ticketRouter POST /tickets/:id/retry', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    vi.clearAllMocks()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('archives the failed tracked phase and writes retry artifacts to the fresh attempt', async () => {
    const { app, ticket } = setupRetryTicketApp()
    ensureActivePhaseAttempt(ticket.id, 'REFINING_PRD')
    upsertLatestPhaseArtifact(
      ticket.id,
      'prd_refined',
      'REFINING_PRD',
      JSON.stringify({ refinedContent: 'failed attempt artifact' }),
    )
    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'REFINING_PRD' } }),
      errorMessage: 'Invalid PRD refinement output',
    })

    const response = await app.request(`/api/tickets/${ticket.id}/retry`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(sendTicketEvent).toHaveBeenCalledWith(ticket.id, { type: 'RETRY' })
    const attempts = listPhaseAttempts(ticket.id, 'REFINING_PRD')
    expect(attempts[0]).toMatchObject({ attemptNumber: 2, state: 'active' })
    expect(attempts[1]).toMatchObject({
      attemptNumber: 1,
      state: 'archived',
      archivedReason: 'manual_retry_after_blocked_error',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('REFINING_PRD')

    upsertLatestPhaseArtifact(
      ticket.id,
      'prd_refined',
      'REFINING_PRD',
      JSON.stringify({ refinedContent: 'successful retry artifact' }),
    )

    const activeArtifacts = listPhaseArtifacts(ticket.id, { phase: 'REFINING_PRD' })
    const archivedArtifacts = listPhaseArtifacts(ticket.id, { phase: 'REFINING_PRD', phaseAttempt: 1 })
    expect(activeArtifacts[0]).toMatchObject({ phaseAttempt: 2 })
    expect(JSON.parse(activeArtifacts[0]!.content ?? '{}')).toMatchObject({ refinedContent: 'successful retry artifact' })
    expect(archivedArtifacts[0]).toMatchObject({ phaseAttempt: 1 })
    expect(JSON.parse(archivedArtifacts[0]!.content ?? '{}')).toMatchObject({ refinedContent: 'failed attempt artifact' })
  })

  it('rejects retry when the blocked status has no previous status', async () => {
    const { app, ticket } = setupRetryTicketApp()
    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      xstateSnapshot: JSON.stringify({ context: {} }),
      errorMessage: 'Missing previous status',
    })

    const response = await app.request(`/api/tickets/${ticket.id}/retry`, { method: 'POST' })

    expect(response.status).toBe(409)
    expect(sendTicketEvent).not.toHaveBeenCalled()
  })

  it('keeps the existing CODING reset path before dispatching retry', async () => {
    const { app, ticket } = setupRetryTicketApp()
    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'CODING' } }),
      errorMessage: 'Bead failed',
    })

    const response = await app.request(`/api/tickets/${ticket.id}/retry`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(recoverCodingBeadWithReset).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ requireReset: true }))
    expect(sendTicketEvent).toHaveBeenCalledWith(ticket.id, { type: 'RETRY' })
  })
})
