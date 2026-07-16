import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockedErrorDiagnostics } from '@shared/errorDiagnostics'
import type { OpenCodeAdapter } from '../opencode/adapter'
import { listOpenCodeSessionsForTicket } from '../opencode/sessionManager'
import { initializeDatabase } from '../db/init'
import { sqlite } from '../db/index'
import { clearProjectDatabaseCache } from '../db/project'
import { opencodeSessions } from '../db/schema'
import { reconcileOpenCodeSessions } from '../startup'
import { attachProject, getProjectContextById } from '../storage/projects'
import {
  createTicket,
  getTicketContext,
  patchTicket,
  recordTicketErrorOccurrence,
} from '../storage/tickets'
import { createFixtureRepoManager } from '../test/fixtureRepo'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-startup-sessions-',
  files: { 'README.md': '# Startup session tests\n' },
})

function createAdapter(getSession: OpenCodeAdapter['getSession']): OpenCodeAdapter {
  return { getSession } as OpenCodeAdapter
}

function setupContinuation(diagnostics: BlockedErrorDiagnostics) {
  const firstProject = attachProject({
    folderPath: repoManager.createRepo(),
    name: 'First project',
    shortname: 'FIRST',
  })
  const secondProject = attachProject({
    folderPath: repoManager.createRepo(),
    name: 'Second project',
    shortname: 'SECOND',
  })
  const firstTicket = createTicket({
    projectId: firstProject.id,
    title: 'Same local id in first project',
    description: 'Must not own the second project session.',
  })
  const ticket = createTicket({
    projectId: secondProject.id,
    title: 'Continuable ticket',
    description: 'Must retain its session after restart.',
  })
  expect(getTicketContext(firstTicket.id)?.localTicketId).toBe(getTicketContext(ticket.id)?.localTicketId)

  const previousStatus = 'REFINING_PRD'
  recordTicketErrorOccurrence(ticket.id, {
    blockedFromStatus: previousStatus,
    errorMessage: diagnostics.summary,
    errorCodes: [],
    diagnostics,
  })
  patchTicket(ticket.id, {
    status: 'BLOCKED_ERROR',
    errorMessage: diagnostics.summary,
    xstateSnapshot: JSON.stringify({ context: { previousStatus } }),
  })
  const context = getTicketContext(ticket.id)!
  context.projectDb.insert(opencodeSessions).values({
    sessionId: diagnostics.sessionId!,
    ticketId: context.localTicketId,
    phase: previousStatus,
    phaseAttempt: 1,
    state: 'active',
  }).run()

  return { firstProject, secondProject, ticket, previousStatus }
}

describe('startup OpenCode session reconciliation', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it.each([
    ['usage limit', { kind: 'opencode_provider', source: 'provider', summary: 'Usage limit reached', sessionId: 'ses-limit', statusCode: 429, isRetryable: true }],
    ['payment block', { kind: 'opencode_provider', source: 'provider', summary: 'Payment required', sessionId: 'ses-payment', statusCode: 402, isRetryable: false }],
    ['transport failure', { kind: 'transport', source: 'opencode', summary: 'Connection reset', sessionId: 'ses-transport' }],
    ['timeout', { kind: 'timeout', source: 'opencode', summary: 'Request timed out', sessionId: 'ses-timeout' }],
  ] as const)('reconnects a blocked-error session for a continuable %s using its project-local ticket', async (_label, diagnostics) => {
    const { firstProject, secondProject, ticket } = setupContinuation(diagnostics)
    const getSession = vi.fn(async (sessionId: string) => ({
      id: sessionId,
      projectPath: getProjectContextById(secondProject.id)!.projectRoot,
      createdAt: new Date().toISOString(),
    }))

    const result = await reconcileOpenCodeSessions(createAdapter(getSession), [firstProject, secondProject])

    expect(result).toEqual({ reconnected: 1, abandoned: 0, preserved: 0 })
    expect(getSession).toHaveBeenCalledWith(diagnostics.sessionId, undefined)
    expect(listOpenCodeSessionsForTicket(ticket.id, ['active'])).toHaveLength(1)
  })

  it('abandons a blocked-error session when the diagnostic session id does not match exactly', async () => {
    const { firstProject, secondProject, ticket } = setupContinuation({
      kind: 'opencode_provider',
      source: 'provider',
      summary: 'Usage limit reached',
      sessionId: 'ses-diagnostic',
      statusCode: 429,
      isRetryable: true,
    })
    const context = getTicketContext(ticket.id)!
    context.projectDb.update(opencodeSessions)
      .set({ sessionId: 'ses-different' })
      .run()
    const getSession = vi.fn()

    const result = await reconcileOpenCodeSessions(createAdapter(getSession), [firstProject, secondProject])

    expect(result).toEqual({ reconnected: 0, abandoned: 1, preserved: 0 })
    expect(getSession).not.toHaveBeenCalled()
    expect(listOpenCodeSessionsForTicket(ticket.id, ['abandoned'])).toHaveLength(1)
  })

  it('abandons a blocked-error session when the active occurrence does not match the previous phase', async () => {
    const { firstProject, secondProject, ticket } = setupContinuation({
      kind: 'opencode_provider',
      source: 'provider',
      summary: 'Usage limit reached',
      sessionId: 'ses-phase-mismatch',
      statusCode: 429,
      isRetryable: true,
    })
    patchTicket(ticket.id, {
      xstateSnapshot: JSON.stringify({ context: { previousStatus: 'VERIFYING_PRD_COVERAGE' } }),
    })
    const getSession = vi.fn()

    const result = await reconcileOpenCodeSessions(createAdapter(getSession), [firstProject, secondProject])

    expect(result).toEqual({ reconnected: 0, abandoned: 1, preserved: 0 })
    expect(getSession).not.toHaveBeenCalled()
    expect(listOpenCodeSessionsForTicket(ticket.id, ['abandoned'])).toHaveLength(1)
  })

  it('preserves a valid continuation session when exact verification fails transiently', async () => {
    const { firstProject, secondProject, ticket } = setupContinuation({
      kind: 'transport',
      source: 'opencode',
      summary: 'OpenCode temporarily unavailable',
      sessionId: 'ses-transient',
    })
    const getSession = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    const result = await reconcileOpenCodeSessions(createAdapter(getSession), [firstProject, secondProject])

    expect(result).toEqual({ reconnected: 0, abandoned: 0, preserved: 1 })
    expect(listOpenCodeSessionsForTicket(ticket.id, ['active'])).toHaveLength(1)
  })

  it('abandons a valid continuation session only when exact lookup confirms it is missing', async () => {
    const { firstProject, secondProject, ticket } = setupContinuation({
      kind: 'timeout',
      source: 'opencode',
      summary: 'Request timed out',
      sessionId: 'ses-missing',
    })

    const result = await reconcileOpenCodeSessions(
      createAdapter(vi.fn(async () => null)),
      [firstProject, secondProject],
    )

    expect(result).toEqual({ reconnected: 0, abandoned: 1, preserved: 0 })
    expect(listOpenCodeSessionsForTicket(ticket.id, ['abandoned'])).toHaveLength(1)
  })
})
