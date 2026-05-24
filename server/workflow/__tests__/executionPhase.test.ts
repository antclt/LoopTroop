import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bead } from '../../phases/beads/types'
import { makeTicketContextFromTicket } from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { getLatestPhaseArtifact, upsertLatestPhaseArtifact } from '../../storage/tickets'
import { readTicketBeads, recoverFailedCodingBead, writeTicketBeads } from '../phases/beadsPhase'
import { phaseIntermediate } from '../phases/state'
import { BEAD_RETRY_BUDGET_EXHAUSTED, OPENCODE_PROVIDER_ERROR } from '../../../shared/errorCodes'
import {
  clearAllPendingSessionContinuationsForTests,
  requestSessionContinuation,
} from '../../opencode/sessionContinuation'

const {
  executeBeadMock,
  recordBeadStartCommitMock,
  commitBeadChangesMock,
  resetToBeadStartMock,
  captureBeadDiffMock,
  assembleBeadContextMock,
  isMockOpenCodeModeMock,
  broadcastMock,
} = vi.hoisted(() => ({
  executeBeadMock: vi.fn(),
  recordBeadStartCommitMock: vi.fn(),
  commitBeadChangesMock: vi.fn(),
  resetToBeadStartMock: vi.fn(),
  captureBeadDiffMock: vi.fn(),
  assembleBeadContextMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
  broadcastMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: isMockOpenCodeModeMock,
}))

vi.mock('../../phases/execution/executor', () => ({
  executeBead: executeBeadMock,
}))

vi.mock('../../phases/execution/gitOps', () => ({
  WORKTREE_RESET_PRESERVE_PATHS: ['.ticket'],
  recordBeadStartCommit: recordBeadStartCommitMock,
  commitBeadChanges: commitBeadChangesMock,
  resetToBeadStart: resetToBeadStartMock,
  captureBeadDiff: captureBeadDiffMock,
}))

vi.mock('../phases/state', async () => {
  const actual = await vi.importActual<typeof import('../phases/state')>('../phases/state')
  return {
    ...actual,
    adapter: {
      assembleBeadContext: assembleBeadContextMock,
    },
  }
})

vi.mock('../../sse/broadcaster', () => ({
  broadcaster: {
    broadcast: broadcastMock,
  },
  SSEBroadcaster: class {},
}))

import { handleCoding, recoverSuccessfulExecutionCheckpointForFinalization } from '../phases/executionPhase'

const repoManager = createTestRepoManager('execution-phase-')

function makePendingBead(id: string, priority: number, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Bead ${id}`,
    description: `Test bead ${id}`,
    status: 'pending',
    priority,
    prdRefs: [],
    acceptanceCriteria: [],
    tests: [],
    testCommands: [],
    contextGuidance: { patterns: [], anti_patterns: [] },
    issueType: 'task',
    externalRef: 'TEST-1',
    labels: [],
    dependencies: { blocked_by: [], blocks: [] },
    targetFiles: [],
    notes: '',
    iteration: 1,
    createdAt: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
    ...extra,
  }
}

function makeDoneBead(id: string, priority: number): Bead {
  return makePendingBead(id, priority, {
    status: 'done',
    completedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    iteration: 1,
  })
}

describe('handleCoding', () => {
  beforeEach(() => {
    resetTestDb()
    clearAllPendingSessionContinuationsForTests()
    phaseIntermediate.clear()
    executeBeadMock.mockReset()
    recordBeadStartCommitMock.mockReset()
    commitBeadChangesMock.mockReset()
    resetToBeadStartMock.mockReset()
    captureBeadDiffMock.mockReset()
    assembleBeadContextMock.mockReset()
    isMockOpenCodeModeMock.mockReset()
    broadcastMock.mockReset()

    // Deterministic defaults
    isMockOpenCodeModeMock.mockReturnValue(false)
    recordBeadStartCommitMock.mockReturnValue('abc123')
    commitBeadChangesMock.mockReturnValue({ committed: true, pushed: false })
    captureBeadDiffMock.mockReturnValue('diff --git a/file.ts b/file.ts')
    assembleBeadContextMock.mockResolvedValue([])
  })

  afterAll(() => {
    clearAllPendingSessionContinuationsForTests()
    resetTestDb()
    repoManager.cleanup()
  })

  it('sends ALL_BEADS_DONE immediately when all beads are already done', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'All beads done shortcut',
    })
    writeTicketBeads(ticket.id, [
      makeDoneBead('bead-1', 1),
      makeDoneBead('bead-2', 2),
    ])
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('sends ERROR event and returns when mock mode is active', async () => {
    isMockOpenCodeModeMock.mockReturnValue(true)
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Mock mode unsupported',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR', codes: ['MOCK_EXECUTION_UNSUPPORTED'] }),
    )
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('sends BEAD_COMPLETE when one bead succeeds with more beads still pending', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead success with more pending',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1),
      makePendingBead('bead-2', 2),
    ])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'BEAD_COMPLETE' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })

    // Verify the lowest-priority bead was executed first
    const executedBead = executeBeadMock.mock.calls[0]![1] as Bead
    expect(executedBead.id).toBe('bead-1')
  })

  it('passes OpenCode retry settings to execution and resets the attempt countdown start time', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-02-02T03:04:05.000Z'))
      const { ticket, context } = createInitializedTestTicket(repoManager, {
        title: 'Attempt countdown reset',
      })
      writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1, {
        startedAt: '2026-01-01T00:00:00.000Z',
      })])
      const sendEvent = vi.fn()

      executeBeadMock.mockImplementationOnce(async (
        _adapter: unknown,
        _bead: unknown,
        _contextParts: unknown,
        _worktreePath: unknown,
        _maxIterations: unknown,
        _perIterationTimeoutMs: unknown,
        _signal: unknown,
        callbacks: {
          opencodeRetryPolicy?: { limit?: number; delayMs?: number }
          onSessionCreated?: (sessionId: string, iteration: number) => void
        },
      ) => {
        expect(callbacks.opencodeRetryPolicy).toEqual({ limit: 10, delayMs: 60_000 })
        callbacks.onSessionCreated?.('ses-retry-policy', 2)
        return {
          success: true,
          beadId: 'bead-1',
          iteration: 2,
          output: 'done',
          errors: [],
        }
      })

      await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

      const finalBead = readTicketBeads(ticket.id).find((bead) => bead.id === 'bead-1')
      expect(finalBead?.startedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(finalBead?.iteration).toBe(2)
      expect(finalBead?.updatedAt).toBe('2026-02-02T03:04:05.000Z')
      expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends ALL_BEADS_DONE when the last pending bead succeeds', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Last bead success',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'BEAD_COMPLETE' })

    const finalBeads = readTicketBeads(ticket.id)
    expect(finalBeads.find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('sends BEAD_ERROR and does not commit when executeBead fails', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead execution failure',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 2,
      output: '',
      errors: ['typecheck failed'],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'BEAD_ERROR' })
    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'BEAD_COMPLETE' }))
    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ALL_BEADS_DONE' }))
    expect(commitBeadChangesMock).not.toHaveBeenCalled()
    expect(captureBeadDiffMock).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'bead_complete',
      expect.anything(),
    )

    const finalBeads = readTicketBeads(ticket.id)
    expect(finalBeads.find((b) => b.id === 'bead-1')?.status).toBe('error')
  })

  it('propagates retry-budget exhaustion codes when a bead uses its per-bead window', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead retry budget exhaustion',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1, { iteration: 5 })])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 10,
      output: '',
      errors: ['Reached the configured per-bead retry budget at iteration 10.'],
      errorCodes: [BEAD_RETRY_BUDGET_EXHAUSTED],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({
      type: 'BEAD_ERROR',
      codes: [BEAD_RETRY_BUDGET_EXHAUSTED],
    })

    const finalBeads = readTicketBeads(ticket.id)
    const failedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(failedBead?.status).toBe('error')
    expect(failedBead?.iteration).toBe(10)
  })

  it('propagates underlying OpenCode diagnostics with bead failures', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Bead failure with OpenCode diagnostics',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 5,
      output: '',
      errors: ['Iteration 5: No completion marker found'],
      errorCodes: [BEAD_RETRY_BUDGET_EXHAUSTED, OPENCODE_PROVIDER_ERROR],
      diagnostics: {
        kind: 'opencode_provider',
        source: 'provider',
        summary: 'The usage limit has been reached',
        modelId: context.lockedMainImplementer ?? undefined,
        sessionId: 'ses-limit',
      },
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({
      type: 'BEAD_ERROR',
      codes: [BEAD_RETRY_BUDGET_EXHAUSTED, OPENCODE_PROVIDER_ERROR],
      diagnostics: expect.objectContaining({
        kind: 'opencode_provider',
        source: 'provider',
        summary: 'The usage limit has been reached',
        sessionId: 'ses-limit',
      }),
    })
  })

  it('lets continuable OpenCode retry errors bubble for the workflow ERROR path instead of BEAD_ERROR', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Continuable OpenCode retry error',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()
    const retryError = Object.assign(new Error('OpenCode retry budget exhausted after 10 retry event(s): The usage limit has been reached'), {
      blockedErrorDiagnostics: {
        kind: 'opencode_provider',
        source: 'provider',
        summary: 'The usage limit has been reached',
        sessionId: 'ses-limit',
        modelId: context.lockedMainImplementer ?? undefined,
        isRetryable: true,
      },
      blockedErrorCodes: ['OPENCODE_PROVIDER_ERROR'],
    })

    executeBeadMock.mockRejectedValueOnce(retryError)

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('OpenCode retry budget exhausted')

    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'BEAD_ERROR' }))
    expect(commitBeadChangesMock).not.toHaveBeenCalled()
  })

  it('invokes resetToBeadStart and persists notes through the fresh-reload when onContextWipe fires', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Notes updated triggers reset',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockImplementationOnce(async (
      _adapter: unknown,
      _bead: unknown,
      _contextParts: unknown,
      _worktreePath: unknown,
      _maxIterations: unknown,
      _perIterationTimeoutMs: unknown,
      _signal: unknown,
      callbacks: {
        ticketId: string
        model: string
        onContextWipe: (entry: { beadId: string; notes: string; iteration: number }) => Promise<void>
      },
    ) => {
      // Simulate context wipe persistence before executeBead returns.
      await callbacks.onContextWipe({
        beadId: 'bead-1',
        notes: 'context wiped — retrying with notes',
        iteration: 1,
      })
      return {
        success: true,
        beadId: 'bead-1',
        iteration: 1,
        output: 'done',
        errors: [],
      }
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(resetToBeadStartMock).toHaveBeenCalledWith(
      expect.any(String),
      'abc123',
      expect.objectContaining({
        preservePaths: expect.arrayContaining(['.ticket']),
      }),
    )

    // The fresh-reload in handleCoding must not wipe callback-persisted notes.
    const finalBeads = readTicketBeads(ticket.id)
    const executedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(executedBead?.notes).toBe('context wiped — retrying with notes')
    expect(executedBead?.status).toBe('done')
  })

  it('preserves retry notes and iteration when resetToBeadStart fails during context wipe', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Reset failure preserves retry metadata',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1, { iteration: 1 })])
    const sendEvent = vi.fn()

    resetToBeadStartMock.mockImplementation(() => {
      throw new Error('spawnSync git ENOBUFS')
    })

    executeBeadMock.mockImplementationOnce(async (
      _adapter: unknown,
      _bead: unknown,
      _contextParts: unknown,
      _worktreePath: unknown,
      _maxIterations: unknown,
      _perIterationTimeoutMs: unknown,
      _signal: unknown,
      callbacks: {
        onSessionCreated?: (sessionId: string, iteration: number) => void
        onContextWipe: (entry: { beadId: string; notes: string; iteration: number }) => Promise<void>
      },
    ) => {
      callbacks.onSessionCreated?.('session-1', 1)
      await expect(callbacks.onContextWipe({
        beadId: 'bead-1',
        notes: 'retry note after timeout',
        iteration: 1,
      })).rejects.toThrow('spawnSync git ENOBUFS')
      throw new Error('spawnSync git ENOBUFS')
    })

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('spawnSync git ENOBUFS')

    const finalBeads = readTicketBeads(ticket.id)
    const executedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(executedBead?.status).toBe('error')
    expect(executedBead?.iteration).toBe(2)
    expect(executedBead?.notes).toBe('retry note after timeout')

    const recoveredBead = recoverFailedCodingBead(ticket.id)
    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry note after timeout')
  })

  // --- Throw paths ---

  it('throws when there are no beads', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'No beads throw',
    })
    // Beads file is empty (no writeTicketBeads call)
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No beads available for execution')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('throws when no runnable bead exists due to unresolved dependencies', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Blocked bead throw',
    })
    // bead-2 is blocked by bead-1 which is not done (not even present)
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-2', 1, {
        dependencies: { blocked_by: ['bead-1'], blocks: [] },
      }),
    ])
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No runnable bead found; unresolved dependencies remain')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('recovers an interrupted in-progress bead before selecting runnable work', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Recover interrupted in-progress bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'in_progress',
        iteration: 2,
        notes: 'prior interrupted attempt',
        beadStartCommit: 'start-sha',
      }),
    ])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 2,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(resetToBeadStartMock).toHaveBeenCalledWith(
      expect.any(String),
      'start-sha',
      expect.objectContaining({
        preservePaths: expect.arrayContaining(['.ticket']),
      }),
    )
    const executedBead = executeBeadMock.mock.calls[0]![1] as Bead
    expect(executedBead.status).toBe('in_progress')
    expect(executedBead.notes).toBe('prior interrupted attempt')
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
  })

  it('continues an interrupted in-progress bead without resetting when a session continuation is pending', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Continue interrupted in-progress bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'in_progress',
        iteration: 2,
        notes: 'prior interrupted attempt',
        beadStartCommit: 'start-sha',
      }),
    ])
    requestSessionContinuation({
      ticketId: ticket.id,
      phase: 'CODING',
      sessionId: 'ses-continue',
    })
    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 2,
      output: 'done',
      errors: [],
    })
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(resetToBeadStartMock).not.toHaveBeenCalled()
    expect(recordBeadStartCommitMock).not.toHaveBeenCalled()
    const executedBead = executeBeadMock.mock.calls[0]![1] as Bead
    expect(executedBead).toMatchObject({
      id: 'bead-1',
      status: 'in_progress',
      iteration: 2,
      notes: 'prior interrupted attempt',
      beadStartCommit: 'start-sha',
    })
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
  })

  it('finalizes a current persisted execution checkpoint without re-executing the bead', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Finalize matching execution checkpoint',
    })
    const interruptedBead = makePendingBead('bead-1', 1, {
      status: 'in_progress',
      iteration: 2,
      startedAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
      beadStartCommit: 'start-sha',
    })
    writeTicketBeads(ticket.id, [interruptedBead])
    upsertLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING', JSON.stringify({
      success: true,
      beadId: 'bead-1',
      iteration: 2,
      output: 'checkpointed done',
      errors: [],
      checkpoint: {
        beadId: interruptedBead.id,
        iteration: interruptedBead.iteration,
        startedAt: interruptedBead.startedAt,
        updatedAt: interruptedBead.updatedAt,
        beadStartCommit: interruptedBead.beadStartCommit,
      },
    }))
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(executeBeadMock).not.toHaveBeenCalled()
    expect(resetToBeadStartMock).not.toHaveBeenCalled()
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(readTicketBeads(ticket.id).find((bead) => bead.id === 'bead-1')?.status).toBe('done')
  })

  it('does not reuse a stale persisted execution checkpoint after retry/reset changes bead state', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Ignore stale execution checkpoint',
    })
    const interruptedBead = makePendingBead('bead-1', 1, {
      status: 'in_progress',
      iteration: 2,
      startedAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
      beadStartCommit: 'start-sha',
    })
    writeTicketBeads(ticket.id, [interruptedBead])
    upsertLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING', JSON.stringify({
      success: true,
      beadId: 'bead-1',
      iteration: 2,
      output: 'stale done',
      errors: [],
      checkpoint: {
        beadId: interruptedBead.id,
        iteration: interruptedBead.iteration,
        startedAt: interruptedBead.startedAt,
        updatedAt: '2026-01-01T00:00:00.000Z',
        beadStartCommit: interruptedBead.beadStartCommit,
      },
    }))
    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 2,
      output: 'fresh done',
      errors: [],
    })
    const sendEvent = vi.fn()

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(resetToBeadStartMock).toHaveBeenCalledWith(
      expect.any(String),
      'start-sha',
      expect.objectContaining({
        preservePaths: expect.arrayContaining(['.ticket']),
      }),
    )
    expect(executeBeadMock).toHaveBeenCalledTimes(1)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })

    const execArtifact = getLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING')
    const payload = JSON.parse(execArtifact!.content) as {
      output?: string
      checkpoint?: { updatedAt?: string; beadStartCommit?: string | null }
    }
    expect(payload.output).toBe('fresh done')
    expect(payload.checkpoint?.beadStartCommit).toBe('abc123')
    expect(payload.checkpoint?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('blocks interrupted coding recovery when no bead start commit exists', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Interrupted bead without reset anchor',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'in_progress',
        beadStartCommit: null,
      }),
    ])
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('missing bead start commit')

    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  it('throws when lockedMainImplementer is missing', async () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Missing implementer throw',
    })
    const context = makeTicketContextFromTicket(ticket, { lockedMainImplementer: null })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    await expect(
      handleCoding(ticket.id, context, sendEvent, new AbortController().signal),
    ).rejects.toThrow('No locked main implementer is configured for coding')
    expect(executeBeadMock).not.toHaveBeenCalled()
  })

  // --- Artifact assertions ---

  it('inserts bead_execution artifact on success and bead_diff when beadStartCommit is available', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Success artifacts',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    const execArtifact = getLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING')
    expect(execArtifact).toBeDefined()
    const execPayload = JSON.parse(execArtifact!.content) as {
      success: boolean
      beadId: string
      checkpoint?: { beadId?: string; beadStartCommit?: string | null }
    }
    expect(execPayload.success).toBe(true)
    expect(execPayload.beadId).toBe('bead-1')
    expect(execPayload.checkpoint).toMatchObject({
      beadId: 'bead-1',
      beadStartCommit: 'abc123',
    })

    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeDefined()
    expect(diffArtifact!.content).toBe('diff --git a/file.ts b/file.ts')
  })

  it('inserts bead_execution artifact on failure but does not insert bead_diff', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Failure artifacts',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: false,
      beadId: 'bead-1',
      iteration: 1,
      output: '',
      errors: ['lint failed'],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    const execArtifact = getLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING')
    expect(execArtifact).toBeDefined()
    const execPayload = JSON.parse(execArtifact!.content) as {
      success: boolean
      checkpoint?: { beadId?: string; beadStartCommit?: string | null }
    }
    expect(execPayload.success).toBe(false)
    expect(execPayload.checkpoint).toMatchObject({
      beadId: 'bead-1',
      beadStartCommit: 'abc123',
    })

    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeUndefined()
  })

  // --- recordBeadStartCommit failure branch ---

  it('proceeds with execution when recordBeadStartCommit throws', async () => {
    recordBeadStartCommitMock.mockImplementation(() => {
      throw new Error('git rev-parse failed')
    })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'recordBeadStartCommit throws',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    // With no beadStartCommit recorded, the success path should still avoid reset attempts.
    expect(resetToBeadStartMock).not.toHaveBeenCalled()
    // bead_diff requires beadStartCommit, so it should not be inserted
    const diffArtifact = getLatestPhaseArtifact(ticket.id, 'bead_diff:bead-1', 'CODING')
    expect(diffArtifact).toBeUndefined()
  })

  // --- Git error recovery ---

  it('keeps the bead retryable and blocks progress when finalization throws', async () => {
    commitBeadChangesMock.mockImplementation(() => {
      throw new Error('git commit failed')
    })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'commitBeadChanges throws',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'BEAD_ERROR',
      codes: ['BEAD_FINALIZATION_FAILED'],
    }))
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'BEAD_COMPLETE' })
    expect(broadcastMock).not.toHaveBeenCalledWith(expect.anything(), 'bead_complete', expect.anything())
    expect(captureBeadDiffMock).not.toHaveBeenCalled()
    const finalBeads = readTicketBeads(ticket.id)
    const failedBead = finalBeads.find((b) => b.id === 'bead-1')
    expect(failedBead?.status).toBe('error')
    expect(failedBead?.notes).toContain('Finalization failed after successful implementation: git commit failed')
  })

  it('keeps the bead retryable and blocks progress when local commit returns an error', async () => {
    commitBeadChangesMock.mockReturnValue({ committed: false, pushed: false, error: 'git add failed: permission denied' })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'commitBeadChanges returns error',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'BEAD_ERROR',
      codes: ['BEAD_FINALIZATION_FAILED'],
    }))
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(broadcastMock).not.toHaveBeenCalledWith(expect.anything(), 'bead_complete', expect.anything())
    expect(readTicketBeads(ticket.id).find((b) => b.id === 'bead-1')?.status).toBe('error')
  })

  it('marks the bead done when finalization is a true no-op', async () => {
    commitBeadChangesMock.mockReturnValue({ committed: false, pushed: false })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'No-op finalization',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(readTicketBeads(ticket.id).find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('treats push failure as a warning after successful local commit', async () => {
    commitBeadChangesMock.mockReturnValue({ committed: true, pushed: false, error: 'remote rejected push' })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Push warning finalization',
    })
    writeTicketBeads(ticket.id, [makePendingBead('bead-1', 1)])
    const sendEvent = vi.fn()

    executeBeadMock.mockResolvedValueOnce({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'done',
      errors: [],
    })

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(sendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'BEAD_ERROR' }))
    expect(readTicketBeads(ticket.id).find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('re-finalizes a successful execution checkpoint after a finalization retry without resetting work', async () => {
    commitBeadChangesMock.mockReturnValue({ committed: false, pushed: false })
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Re-finalize checkpoint',
    })
    const failedFinalizationBead = makePendingBead('bead-1', 1, {
      status: 'error',
      startedAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
      beadStartCommit: 'start-sha',
    })
    writeTicketBeads(ticket.id, [failedFinalizationBead])
    upsertLatestPhaseArtifact(ticket.id, 'bead_execution:bead-1', 'CODING', JSON.stringify({
      success: true,
      beadId: 'bead-1',
      iteration: 1,
      output: 'checkpointed success',
      errors: [],
      checkpoint: {
        beadId: failedFinalizationBead.id,
        iteration: failedFinalizationBead.iteration,
        startedAt: failedFinalizationBead.startedAt,
        updatedAt: failedFinalizationBead.updatedAt,
        beadStartCommit: failedFinalizationBead.beadStartCommit,
      },
    }))
    const sendEvent = vi.fn()

    const recovered = recoverSuccessfulExecutionCheckpointForFinalization(ticket.id)
    expect(recovered?.status).toBe('in_progress')

    await handleCoding(ticket.id, context, sendEvent, new AbortController().signal)

    expect(executeBeadMock).not.toHaveBeenCalled()
    expect(resetToBeadStartMock).not.toHaveBeenCalled()
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ALL_BEADS_DONE' })
    expect(readTicketBeads(ticket.id).find((b) => b.id === 'bead-1')?.status).toBe('done')
  })

  it('requeues the latest failed bead for retry without clearing notes or iteration', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Retry failed coding bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'error',
        iteration: 2,
        notes: 'retry guidance',
        beadStartCommit: 'abc123',
      }),
      makePendingBead('bead-2', 2, {
        dependencies: { blocked_by: ['bead-1'], blocks: [] },
      }),
    ])

    const recoveredBead = recoverFailedCodingBead(ticket.id)

    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry guidance')
    expect(recoveredBead?.beadStartCommit).toBe('abc123')
  })

  it('requeues the latest in-progress bead when coding blocked before status flipped to error', () => {
    const { ticket } = createInitializedTestTicket(repoManager, {
      title: 'Retry blocked in-progress coding bead',
    })
    writeTicketBeads(ticket.id, [
      makePendingBead('bead-1', 1, {
        status: 'in_progress',
        iteration: 2,
        notes: 'retry guidance',
        beadStartCommit: 'abc123',
      }),
    ])

    const recoveredBead = recoverFailedCodingBead(ticket.id)

    expect(recoveredBead?.id).toBe('bead-1')
    expect(recoveredBead?.status).toBe('pending')
    expect(recoveredBead?.iteration).toBe(2)
    expect(recoveredBead?.notes).toBe('retry guidance')
    expect(recoveredBead?.beadStartCommit).toBe('abc123')
  })
})
