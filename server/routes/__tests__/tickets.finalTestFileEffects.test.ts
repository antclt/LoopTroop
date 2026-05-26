import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import {
  createTicket,
  ensureActivePhaseAttempt,
  getLatestPhaseArtifact,
  getTicketByRef,
  insertPhaseArtifact,
  patchTicket,
  recordTicketErrorOccurrence,
} from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { ticketRouter } from '../tickets'
import {
  FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
  FINAL_TEST_FILE_EFFECTS_ERROR_CODE,
  FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
} from '@shared/finalTestFileEffects'

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
  }
})

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-ticket-file-effects-route-',
  files: {
    'README.md': '# file effects route test\n',
  },
})

function createBlockedFileEffectsTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Final test file effects',
    description: 'Verify final-test file effect recovery.',
  })
  const init = initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  ensureActivePhaseAttempt(ticket.id, 'INTEGRATING_CHANGES')
  recordTicketErrorOccurrence(ticket.id, {
    blockedFromStatus: 'INTEGRATING_CHANGES',
    errorMessage: 'Final testing left unclassified dirty file(s): tmp/final-output.txt',
    errorCodes: [FINAL_TEST_FILE_EFFECTS_ERROR_CODE],
  })
  patchTicket(ticket.id, {
    status: 'BLOCKED_ERROR',
    xstateSnapshot: JSON.stringify({ context: { previousStatus: 'INTEGRATING_CHANGES' } }),
    errorMessage: 'Final testing left unclassified dirty file(s): tmp/final-output.txt',
    branchName: init.branchName,
  })

  insertPhaseArtifact(ticket.id, {
    phase: 'RUNNING_FINAL_TEST',
    artifactType: 'final_test_file_effects_audit',
    content: JSON.stringify({
      status: 'blocked',
      capturedAt: '2026-05-26T00:00:00.000Z',
      baselineDirtyFiles: [],
      dirtyFilesAfterTesting: [
        {
          path: 'tmp/final-output.txt',
          indexStatus: '?',
          worktreeStatus: '?',
          rawStatus: '??',
          untracked: true,
          contentSignature: 'test',
        },
      ],
      producedByFinalTesting: [
        {
          path: 'tmp/final-output.txt',
          indexStatus: '?',
          worktreeStatus: '?',
          rawStatus: '??',
          untracked: true,
          contentSignature: 'test',
        },
      ],
      declaredEffects: [],
      candidateFiles: [],
      temporaryFiles: [],
      unexpectedFiles: [],
      unclassifiedFiles: ['tmp/final-output.txt'],
      decisionRequiredFiles: ['tmp/final-output.txt'],
      message: 'Final testing left unclassified dirty file(s): tmp/final-output.txt',
    }),
  })

  const app = new Hono()
  app.route('/api', ticketRouter)
  return { app, ticket, init }
}

describe('ticketRouter final-test file effects recovery', () => {
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

  it('exposes include and discard actions for unresolved final-test file effect blocks', () => {
    const { ticket } = createBlockedFileEffectsTicket()

    const blocked = getTicketByRef(ticket.id)

    expect(blocked?.availableActions).toEqual(expect.arrayContaining([
      FINAL_TEST_FILE_EFFECTS_INCLUDE_ACTION,
      FINAL_TEST_FILE_EFFECTS_DISCARD_ACTION,
    ]))
    expect(blocked?.availableActions).not.toContain('continue')
  })

  it('includes unclassified final-test-produced files by writing an override and retrying integration', async () => {
    const { app, ticket } = createBlockedFileEffectsTicket()

    const response = await app.request(`/api/tickets/${ticket.id}/include-final-test-files`, { method: 'POST' })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string }
    expect(payload.status).toBe('INTEGRATING_CHANGES')
    const override = getLatestPhaseArtifact(ticket.id, 'final_test_file_effects_override', 'INTEGRATING_CHANGES')
    expect(JSON.parse(override!.content)).toMatchObject({
      decision: 'include_unclassified_as_candidate',
      files: ['tmp/final-output.txt'],
      source: 'user',
    })
  })

  it('discards only audited final-test-produced files and retries integration', async () => {
    const { app, ticket, init } = createBlockedFileEffectsTicket()
    const dirtyFile = join(init.worktreePath, 'tmp/final-output.txt')
    mkdirSync(dirname(dirtyFile), { recursive: true })
    writeFileSync(dirtyFile, 'temporary output\n')

    const response = await app.request(`/api/tickets/${ticket.id}/discard-final-test-files`, { method: 'POST' })

    expect(response.status).toBe(200)
    const payload = await response.json() as { status?: string }
    expect(payload.status).toBe('INTEGRATING_CHANGES')
    expect(existsSync(dirtyFile)).toBe(false)
    const override = getLatestPhaseArtifact(ticket.id, 'final_test_file_effects_override', 'INTEGRATING_CHANGES')
    expect(JSON.parse(override!.content)).toMatchObject({
      decision: 'discard_unclassified',
      files: ['tmp/final-output.txt'],
      source: 'user',
    })
  })
})
