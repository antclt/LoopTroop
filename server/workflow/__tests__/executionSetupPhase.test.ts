import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeBeadsYaml, TEST } from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { getLatestPhaseArtifact, upsertLatestPhaseArtifact } from '../../storage/tickets'

const {
  executeExecutionSetupWithRetriesMock,
  recordWorktreeStartCommitMock,
  resetWorktreeToCommitMock,
  isMockOpenCodeModeMock,
} = vi.hoisted(() => ({
  executeExecutionSetupWithRetriesMock: vi.fn(),
  recordWorktreeStartCommitMock: vi.fn(),
  resetWorktreeToCommitMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
}))

vi.mock('../../phases/executionSetup/executor', () => ({
  executeExecutionSetupWithRetries: executeExecutionSetupWithRetriesMock,
}))

vi.mock('../../phases/execution/gitOps', () => ({
  WORKTREE_RESET_PRESERVE_PATHS: ['.ticket'],
  recordWorktreeStartCommit: recordWorktreeStartCommitMock,
  resetWorktreeToCommit: resetWorktreeToCommitMock,
  recordBeadStartCommit: vi.fn(),
  resetToBeadStart: vi.fn(),
  commitBeadChanges: vi.fn(),
  captureBeadDiff: vi.fn(),
}))

vi.mock('../../opencode/factory', async () => {
  const actual = await vi.importActual<typeof import('../../opencode/factory')>('../../opencode/factory')
  return {
    ...actual,
    isMockOpenCodeMode: isMockOpenCodeModeMock,
  }
})

import { handleExecutionSetup } from '../phases/executionSetupPhase'

const repoManager = createTestRepoManager('execution-setup-phase-')

function writeExecutionSetupPlan(ticketId: string, externalId: string) {
  upsertLatestPhaseArtifact(ticketId, 'execution_setup_plan', 'WAITING_EXECUTION_SETUP_APPROVAL', JSON.stringify({
    schema_version: 1,
    ticket_id: externalId,
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary: 'Workspace is ready.',
    readiness: {
      status: 'ready',
      actions_required: false,
      evidence: ['Repository files are present.'],
      gaps: [],
    },
    temp_roots: ['.ticket/runtime/execution-setup'],
    steps: [],
    project_commands: {
      prepare: [],
      test_full: [],
      lint_full: [],
      typecheck_full: [],
    },
    quality_gate_policy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      full_project_fallback: 'never-block-on-unrelated-baseline',
    },
    cautions: [],
  }, null, 2))
}

function readyExecutionSetupReport(ticketId: string) {
  return {
    status: 'ready' as const,
    ready: true,
    checkedAt: '2026-04-09T12:00:00.000Z',
    preparedBy: TEST.implementer,
    summary: 'ready',
    profile: {
      schemaVersion: 1,
      ticketId,
      artifact: 'execution_setup_profile' as const,
      status: 'ready' as const,
      summary: 'ready',
      tempRoots: ['.ticket/runtime/execution-setup'],
      bootstrapCommands: [],
      reusableArtifacts: [],
      projectCommands: {
        prepare: [],
        testFull: [],
        lintFull: [],
        typecheckFull: [],
      },
      qualityGatePolicy: {
        tests: 'bead-test-commands-first',
        lint: 'impacted-or-package',
        typecheck: 'impacted-or-package',
        fullProjectFallback: 'never-block-on-unrelated-baseline',
      },
      cautions: [],
    },
    checks: {
      workspace: 'pass',
      tooling: 'pass',
      tempScope: 'pass',
      policy: 'pass',
    },
    modelOutput: '<EXECUTION_SETUP_RESULT>{}</EXECUTION_SETUP_RESULT>',
    errors: [],
  }
}

describe('handleExecutionSetup', () => {
  beforeEach(() => {
    resetTestDb()
    executeExecutionSetupWithRetriesMock.mockReset()
    recordWorktreeStartCommitMock.mockReset()
    resetWorktreeToCommitMock.mockReset()
    isMockOpenCodeModeMock.mockReset()

    recordWorktreeStartCommitMock.mockReturnValue('setup-start-sha')
    isMockOpenCodeModeMock.mockReturnValue(false)
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('preserves LoopTroop ticket artifacts when resetting before an execution-setup retry', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Execution setup reset preservation',
    })
    writeExecutionSetupPlan(ticket.id, ticket.externalId)
    writeFileSync(paths.beadsPath, makeBeadsYaml({ beadCount: 1 }))
    mkdirSync(join(paths.executionSetupDir, 'tool-cache', 'go'), { recursive: true })
    writeFileSync(join(paths.executionSetupDir, 'tool-cache', 'go', 'VERSION'), 'go1.25.0\n')
    writeFileSync(join(paths.executionSetupDir, 'env.sh'), 'export PATH=tool-cache/go/bin:$PATH\n')
    writeFileSync(join(paths.executionSetupDir, 'run'), '#!/usr/bin/env sh\n. .ticket/runtime/execution-setup/env.sh\nexec "$@"\n')
    writeFileSync(paths.executionSetupProfilePath, '{"status":"stale"}\n')

    executeExecutionSetupWithRetriesMock.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[5] as {
        beforeRetry: (entry: {
          attempt: number
          nextAttempt: number
          report: unknown
          generation: { session: { id: string } }
          note: string
          notes: string[]
        }) => Promise<void> | void
      }
      await callbacks.beforeRetry({
        attempt: 1,
        nextAttempt: 2,
        report: { ready: false },
        generation: { session: { id: 'ses-setup-1' } },
        note: 'retry after failed setup',
        notes: ['retry after failed setup'],
      })
      return readyExecutionSetupReport(ticket.externalId)
    })

    const sendEvent = vi.fn()
    await handleExecutionSetup(
      ticket.id,
      {
        ...context,
        lockedMainImplementer: TEST.implementer,
      },
      sendEvent,
      new AbortController().signal,
    )

    expect(resetWorktreeToCommitMock).toHaveBeenCalledWith(
      paths.worktreePath,
      'setup-start-sha',
      expect.objectContaining({
        preservePaths: expect.arrayContaining(['.ticket']),
      }),
    )
    expect(existsSync(join(paths.executionSetupDir, 'tool-cache', 'go', 'VERSION'))).toBe(true)
    expect(existsSync(join(paths.executionSetupDir, 'env.sh'))).toBe(false)
    expect(existsSync(join(paths.executionSetupDir, 'run'))).toBe(false)
    expect(existsSync(paths.executionSetupProfilePath)).toBe(true)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'EXECUTION_SETUP_READY' })
  })

  it('rejects a schema-compatible setup result when tooling checks fail', async () => {
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Execution setup tooling gate',
    })
    writeExecutionSetupPlan(ticket.id, ticket.externalId)

    executeExecutionSetupWithRetriesMock.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[5] as {
        evaluateGeneration: (entry: { attempt: number; generation: unknown }) => Promise<unknown>
      }
      return await callbacks.evaluateGeneration({
        attempt: 1,
        generation: {
          session: { id: 'ses-setup-tooling-fail' },
          output: '<EXECUTION_SETUP_RESULT>{"status":"ready"}</EXECUTION_SETUP_RESULT>',
          result: {
            status: 'ready',
            summary: 'Required launcher is unavailable.',
            profile: readyExecutionSetupReport(ticket.externalId).profile,
            checks: {
              workspace: 'pass',
              tooling: 'fail',
              tempScope: 'pass',
              policy: 'pass',
            },
          },
          parse: {
            markerFound: true,
            result: null,
            errors: [],
          },
          structuredOutput: {
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 0,
          },
        },
      })
    })

    const sendEvent = vi.fn()
    await handleExecutionSetup(
      ticket.id,
      {
        ...context,
        lockedMainImplementer: TEST.implementer,
      },
      sendEvent,
      new AbortController().signal,
    )

    expect(sendEvent).toHaveBeenCalledWith({
      type: 'EXECUTION_SETUP_FAILED',
      errors: ['Execution setup checks must all pass before the setup profile can be accepted.'],
    })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'EXECUTION_SETUP_READY' })
  })

  it('rejects a ready setup result when setup leaves committable project changes', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Execution setup dirty worktree gate',
    })
    writeExecutionSetupPlan(ticket.id, ticket.externalId)

    executeExecutionSetupWithRetriesMock.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[5] as {
        evaluateGeneration: (entry: { attempt: number; generation: unknown }) => Promise<unknown>
      }
      writeFileSync(join(paths.worktreePath, 'setup-dirty.cs'), 'namespace Dirty;\n')

      return await callbacks.evaluateGeneration({
        attempt: 1,
        generation: {
          session: { id: 'ses-setup-dirty' },
          output: '<EXECUTION_SETUP_RESULT>{"status":"ready"}</EXECUTION_SETUP_RESULT>',
          result: {
            status: 'ready',
            summary: 'Ready but dirty.',
            profile: readyExecutionSetupReport(ticket.externalId).profile,
            checks: {
              workspace: 'pass',
              tooling: 'pass',
              tempScope: 'pass',
              policy: 'pass',
            },
          },
          parse: {
            markerFound: true,
            result: null,
            errors: [],
          },
          structuredOutput: {
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 0,
          },
        },
      })
    })

    const sendEvent = vi.fn()
    await handleExecutionSetup(
      ticket.id,
      {
        ...context,
        lockedMainImplementer: TEST.implementer,
      },
      sendEvent,
      new AbortController().signal,
    )

    expect(sendEvent).toHaveBeenCalledWith({
      type: 'EXECUTION_SETUP_FAILED',
      errors: [expect.stringContaining('setup-dirty.cs')],
    })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'EXECUTION_SETUP_READY' })
  })

  it('allows generated setup noise but records gitignore suggestions as profile cautions', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Execution setup generated noise warning',
    })
    writeExecutionSetupPlan(ticket.id, ticket.externalId)

    executeExecutionSetupWithRetriesMock.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[5] as {
        evaluateGeneration: (entry: { attempt: number; generation: unknown }) => Promise<unknown>
      }
      mkdirSync(join(paths.worktreePath, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(join(paths.worktreePath, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')

      return await callbacks.evaluateGeneration({
        attempt: 1,
        generation: {
          session: { id: 'ses-setup-generated-noise' },
          output: '<EXECUTION_SETUP_RESULT>{"status":"ready"}</EXECUTION_SETUP_RESULT>',
          result: {
            status: 'ready',
            summary: 'Ready with generated noise.',
            profile: readyExecutionSetupReport(ticket.externalId).profile,
            checks: {
              workspace: 'pass',
              tooling: 'pass',
              tempScope: 'pass',
              policy: 'pass',
            },
          },
          parse: {
            markerFound: true,
            result: null,
            errors: [],
          },
          structuredOutput: {
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 0,
          },
        },
      })
    })

    const sendEvent = vi.fn()
    await handleExecutionSetup(
      ticket.id,
      {
        ...context,
        lockedMainImplementer: TEST.implementer,
      },
      sendEvent,
      new AbortController().signal,
    )

    expect(sendEvent).toHaveBeenCalledWith({ type: 'EXECUTION_SETUP_READY' })
    const profileArtifact = getLatestPhaseArtifact(ticket.id, 'execution_setup_profile', 'PREPARING_EXECUTION_ENV')
    expect(profileArtifact?.content).toContain('node_modules/pkg/index.js')
    expect(profileArtifact?.content).toContain('Suggested .gitignore entries: node_modules/')
  })
})
