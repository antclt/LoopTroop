import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { writeJsonl } from '../../io/jsonl'
import { getTicketByRef } from '../tickets'
import { resolveReviewCutoffStatus } from '../ticketQueries'

const runtimeRepoManager = createTestRepoManager('ticket-runtime-qa-origin-')

describe('resolveReviewCutoffStatus', () => {
  it('uses the pre-error phase when a canceled ticket was canceled from BLOCKED_ERROR', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'BLOCKED_ERROR', 'CODING')).toBe('CODING')
  })

  it('keeps ordinary canceled tickets on their last working phase', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'CODING')).toBe('CODING')
  })

  it('keeps live blocked errors on the phase that failed', () => {
    expect(resolveReviewCutoffStatus('BLOCKED_ERROR', 'CODING')).toBe('CODING')
  })

  it('fails conservative when the blocked-error history is missing', () => {
    expect(resolveReviewCutoffStatus('CANCELED', 'BLOCKED_ERROR')).toBeNull()
  })
})

describe('runtime Manual QA bead origin projection', () => {
  beforeEach(() => resetTestDb())
  afterAll(() => {
    resetTestDb()
    runtimeRepoManager.cleanup()
  })

  it('projects a validated typed origin and drops malformed or unsafe origins', () => {
    const setup = createInitializedTestTicket(runtimeRepoManager, { title: 'Runtime QA origin' })
    const origin = {
      schemaVersion: 1,
      actionId: 'manual-qa-submit-one',
      sourceTicketId: setup.ticket.id,
      sourceTicketExternalId: setup.ticket.externalId,
      version: 2,
      modelId: 'provider/manual-qa-model',
      modelSupportsImages: true,
      createdFromManualQaAt: '2026-07-13T12:00:00.000Z',
      sourceItems: [{
        itemId: 'qa-v2-001',
        lineageId: 'delete-ticket',
        behavior: 'Deleting a ticket removes it from the board.',
        observation: 'The ticket remained after confirmation.',
        expectedResult: 'The ticket disappears and stays removed after refresh.',
        evidence: [{
          id: 'screenshot-one',
          originalName: 'failure.png',
          mediaType: 'image/png',
          size: 128,
          sha256: 'a'.repeat(64),
          relativePath: 'manual-qa/v2/evidence/item-qa-v2-001/screenshot-one.png',
        }],
        links: [{ id: 'issue-reference', url: 'https://example.com/issue', label: 'Issue' }],
      }],
      imageDelivery: 'attached',
    }
    writeJsonl(setup.paths.beadsPath, [
      { id: 'qa-fix-valid', title: 'Fix deletion', status: 'pending', iteration: 1, qaOrigin: origin },
      {
        id: 'qa-fix-unsafe-link',
        title: 'Reject unsafe origin',
        status: 'pending',
        iteration: 1,
        qaOrigin: {
          ...origin,
          sourceItems: [{ ...origin.sourceItems[0], links: [{ id: 'unsafe', url: 'javascript:alert(1)' }] }],
        },
      },
    ])

    const runtimeBeads = getTicketByRef(setup.ticket.id)?.runtime.beads
    expect(runtimeBeads?.[0]?.qaOrigin).toEqual(origin)
    expect(runtimeBeads?.[1]?.qaOrigin).toBeNull()
  })

  it('preserves the bead update timestamp used to time the active iteration', () => {
    const setup = createInitializedTestTicket(runtimeRepoManager, { title: 'Runtime bead timestamp' })
    writeJsonl(setup.paths.beadsPath, [{
      id: 'active-bead',
      title: 'Active bead',
      status: 'in_progress',
      iteration: 2,
      startedAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-17T04:45:20.704Z',
    }])

    expect(getTicketByRef(setup.ticket.id)?.runtime.beads[0]).toMatchObject({
      startedAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-17T04:45:20.704Z',
    })
  })
})
