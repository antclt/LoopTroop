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
  isAttemptTrackedPhase,
  listPhaseArtifacts,
  listPhaseAttempts,
  patchTicket,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { WORKFLOW_PHASES } from '@shared/workflowMeta'

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

  it('tracks every retry-resumable non-implementation workflow status', () => {
    const expectedTracked = WORKFLOW_PHASES
      .filter((phase) => phase.groupId !== 'implementation' && phase.groupId !== 'done' && phase.groupId !== 'errors')
      .map((phase) => phase.id)
    const expectedUntracked = WORKFLOW_PHASES
      .filter((phase) => phase.groupId === 'implementation' || phase.groupId === 'done' || phase.groupId === 'errors')
      .map((phase) => phase.id)

    expect(expectedTracked).toEqual(expect.arrayContaining([
      'DRAFT',
      'PRE_FLIGHT_CHECK',
      'PREPARING_EXECUTION_ENV',
      'RUNNING_FINAL_TEST',
      'INTEGRATING_CHANGES',
      'CREATING_PULL_REQUEST',
      'WAITING_PR_REVIEW',
      'CLEANING_ENV',
    ]))
    expect(expectedUntracked).toEqual(expect.arrayContaining(['CODING', 'COMPLETED', 'CANCELED', 'BLOCKED_ERROR']))
    for (const phase of expectedTracked) {
      expect(isAttemptTrackedPhase(phase)).toBe(true)
    }
    for (const phase of expectedUntracked) {
      expect(isAttemptTrackedPhase(phase)).toBe(false)
    }
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

  it.each([
    {
      phase: 'PREPARING_EXECUTION_ENV',
      artifactType: 'execution_setup_report',
      failedContent: { status: 'failed', summary: 'setup blocker' },
      successfulContent: { status: 'ready', summary: 'setup ready' },
    },
    {
      phase: 'RUNNING_FINAL_TEST',
      artifactType: 'final_test_report',
      failedContent: { status: 'failed', summary: 'test blocker' },
      successfulContent: { status: 'passed', summary: 'tests passed' },
    },
  ])('versions manual retry artifacts for $phase', async ({ phase, artifactType, failedContent, successfulContent }) => {
    const { app, ticket } = setupRetryTicketApp()
    ensureActivePhaseAttempt(ticket.id, phase)
    upsertLatestPhaseArtifact(
      ticket.id,
      artifactType,
      phase,
      JSON.stringify(failedContent),
    )
    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: phase } }),
      errorMessage: `${phase} failed`,
    })

    const response = await app.request(`/api/tickets/${ticket.id}/retry`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(sendTicketEvent).toHaveBeenCalledWith(ticket.id, { type: 'RETRY' })
    const attempts = listPhaseAttempts(ticket.id, phase)
    expect(attempts[0]).toMatchObject({ attemptNumber: 2, state: 'active' })
    expect(attempts[1]).toMatchObject({
      attemptNumber: 1,
      state: 'archived',
      archivedReason: 'manual_retry_after_blocked_error',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe(phase)

    upsertLatestPhaseArtifact(
      ticket.id,
      artifactType,
      phase,
      JSON.stringify(successfulContent),
    )

    const activeArtifacts = listPhaseArtifacts(ticket.id, { phase })
    const archivedArtifacts = listPhaseArtifacts(ticket.id, { phase, phaseAttempt: 1 })
    expect(activeArtifacts[0]).toMatchObject({ phaseAttempt: 2 })
    expect(JSON.parse(activeArtifacts[0]!.content ?? '{}')).toMatchObject(successfulContent)
    expect(archivedArtifacts[0]).toMatchObject({ phaseAttempt: 1 })
    expect(JSON.parse(archivedArtifacts[0]!.content ?? '{}')).toMatchObject(failedContent)
  })

  it('creates an archived DRAFT attempt when no active attempt row exists before retry', async () => {
    const { app, ticket } = setupRetryTicketApp()
    patchTicket(ticket.id, {
      status: 'BLOCKED_ERROR',
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'DRAFT' } }),
      errorMessage: 'Start blocked during initialization',
    })

    const response = await app.request(`/api/tickets/${ticket.id}/retry`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(sendTicketEvent).toHaveBeenCalledWith(ticket.id, { type: 'RETRY' })
    const attempts = listPhaseAttempts(ticket.id, 'DRAFT')
    expect(attempts[0]).toMatchObject({ attemptNumber: 2, state: 'active' })
    expect(attempts[1]).toMatchObject({
      attemptNumber: 1,
      state: 'archived',
      archivedReason: 'manual_retry_after_blocked_error',
    })
    expect(getTicketByRef(ticket.id)?.status).toBe('DRAFT')
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
    expect(listPhaseAttempts(ticket.id, 'CODING')).toHaveLength(1)
    expect(listPhaseAttempts(ticket.id, 'CODING')[0]).toMatchObject({
      attemptNumber: 1,
      state: 'active',
      archivedReason: null,
    })
  })
})
