import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import type { GenerateExecutionSetupResult } from '../generator'
import type { ExecutionSetupReport } from '../types'

const { generateExecutionSetupMock } = vi.hoisted(() => ({
  generateExecutionSetupMock: vi.fn(),
}))

vi.mock('../generator', () => ({
  generateExecutionSetup: generateExecutionSetupMock,
}))

import { executeExecutionSetupWithRetries } from '../executor'

function buildGeneration(attempt: number): GenerateExecutionSetupResult {
  return {
    session: { id: `setup-session-${attempt}` },
    output: 'go is missing; attempted user-space provisioning but the download failed',
    result: null,
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
    rawAttempts: [],
  }
}

function buildToolingFailureReport(
  attempt: number,
  provisioningAttempts = [
    {
      strategy: 'official archive',
      commands: ['./install-go --prefix .ticket/runtime/execution-setup/tool-cache/go'],
      result: 'failed',
      reason: 'download failed',
    },
    {
      strategy: 'repository version manager',
      commands: ['./repo-toolchain install go'],
      result: 'failed',
      reason: 'version manager failed',
    },
  ],
): ExecutionSetupReport {
  return {
    status: 'failed',
    ready: false,
    checkedAt: `2026-05-21T12:00:0${attempt}.000Z`,
    preparedBy: 'model-a',
    summary: 'Go is missing; attempted user-space provisioning under tool-cache but the download failed.',
    profile: {
      schemaVersion: 1,
      ticketId: 'T-1',
      artifact: 'execution_setup_profile',
      status: 'ready',
      summary: 'Go toolchain could not be prepared.',
      tempRoots: ['.ticket/runtime/execution-setup', '.ticket/runtime/execution-setup/tool-cache'],
      workspaceInputs: [],
      bootstrapCommands: [],
      toolingProbeCommands: [],
      workspaceProbes: [],
      gitHooks: {
        policy: 'validate_explicitly',
        detected: [],
        validationCommands: [],
      },
      toolRequirements: [
        {
          launcher: 'go',
          requiredBy: ['project_commands.test_full[0]'],
          status: 'failed',
          missingProbe: './.ticket/runtime/execution-setup/run go version',
          provisioningAttempts,
          finalProbe: './.ticket/runtime/execution-setup/run go version',
          failureReason: 'go provisioning failed',
        },
      ],
      reusableArtifacts: [
        {
          path: '.ticket/runtime/execution-setup/tool-cache',
          kind: 'cache',
          purpose: 'user-space toolchain cache',
        },
      ],
      projectCommands: {
        prepare: [],
        testFull: ['./.ticket/runtime/execution-setup/run go test ./...'],
        lintFull: [],
        typecheckFull: [],
      },
      qualityGatePolicy: {
        tests: 'bead-test-commands-first',
        lint: 'impacted-or-package',
        typecheck: 'impacted-or-package',
        fullProjectFallback: 'never-block-on-unrelated-baseline',
      },
      cautions: ['Go toolchain provisioning failed after downloading the official archive.'],
    },
    checks: {
      workspace: 'pass',
      tooling: 'fail',
      tempScope: 'pass',
      policy: 'pass',
    },
    modelOutput: 'go provisioning failed',
    errors: ['Execution setup checks must all pass before the setup profile can be accepted.'],
  }
}

describe('executeExecutionSetupWithRetries', () => {
  beforeEach(() => {
    generateExecutionSetupMock.mockReset()
  })

  it('stops early when the same tooling blocker repeats after a provisioning attempt', async () => {
    generateExecutionSetupMock
      .mockResolvedValueOnce(buildGeneration(1))
      .mockResolvedValueOnce(buildGeneration(2))

    const beforeRetry = vi.fn()
    const onFailedAttempt = vi.fn()
    const onRetriesExhausted = vi.fn()

    const report = await executeExecutionSetupWithRetries(
      new MockOpenCodeAdapter(),
      [{ type: 'text', content: 'Execution setup context' }],
      '/tmp/project',
      undefined,
      {
        model: 'model-a',
        maxIterations: 5,
        timeoutMs: 60_000,
      },
      {
        evaluateGeneration: async ({ attempt }) => buildToolingFailureReport(attempt),
        beforeRetry,
        onFailedAttempt,
        onRetriesExhausted,
      },
    )

    expect(generateExecutionSetupMock).toHaveBeenCalledTimes(2)
    expect(beforeRetry).toHaveBeenCalledTimes(1)
    expect(report.ready).toBe(false)
    expect(report.attempt).toBe(2)
    expect(report.errors).toContain(
      'Repeated tooling setup failure detected; stopping early because the same tooling blocker repeated after a provisioning attempt.',
    )
    expect(report.attemptHistory).toHaveLength(2)
    expect(report.attemptHistory?.[1]?.errors).toContain(
      'Repeated tooling setup failure detected; stopping early because the same tooling blocker repeated after a provisioning attempt.',
    )
    expect(onFailedAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      attempt: 2,
      canRetry: false,
    }))
    expect(onRetriesExhausted).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 2,
      maxIterations: 5,
      reason: 'repeated_tooling_failure',
    }))
  })

  it('uses bounded extra attempts when provisioning evidence has only one strategy after the base budget', async () => {
    generateExecutionSetupMock
      .mockResolvedValueOnce(buildGeneration(1))
      .mockResolvedValueOnce(buildGeneration(2))
      .mockResolvedValueOnce(buildGeneration(3))

    const oneStrategyAttempt = [
      {
        strategy: 'official archive',
        commands: ['./install-go --prefix .ticket/runtime/execution-setup/tool-cache/go'],
        result: 'failed',
        reason: 'download failed',
      },
    ]
    const beforeRetry = vi.fn()
    const onAttemptStart = vi.fn()
    const onFailedAttempt = vi.fn()
    const onRetriesExhausted = vi.fn()

    const report = await executeExecutionSetupWithRetries(
      new MockOpenCodeAdapter(),
      [{ type: 'text', content: 'Execution setup context' }],
      '/tmp/project',
      undefined,
      {
        model: 'model-a',
        maxIterations: 1,
        timeoutMs: 60_000,
      },
      {
        evaluateGeneration: async ({ attempt }) => buildToolingFailureReport(attempt, oneStrategyAttempt),
        beforeRetry,
        onAttemptStart,
        onFailedAttempt,
        onRetriesExhausted,
      },
    )

    expect(generateExecutionSetupMock).toHaveBeenCalledTimes(3)
    expect(beforeRetry).toHaveBeenCalledTimes(2)
    expect(report.ready).toBe(false)
    expect(report.attempt).toBe(3)
    expect(report.errors).not.toContain(
      'Repeated tooling setup failure detected; stopping early because the same tooling blocker repeated after a provisioning attempt.',
    )
    expect(report.retryNotes?.every((note) => note.includes('must not repeat the same provisioning command unchanged'))).toBe(true)
    expect(onAttemptStart).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({
      isExtraToolingPersistenceAttempt: true,
      extraToolingPersistenceAttempt: 1,
    }))
    expect(onAttemptStart).toHaveBeenNthCalledWith(3, 3, expect.objectContaining({
      isExtraToolingPersistenceAttempt: true,
      extraToolingPersistenceAttempt: 2,
    }))
    expect(onFailedAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      attempt: 3,
      canRetry: false,
    }))
    expect(onRetriesExhausted).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 3,
      maxIterations: 1,
      reason: 'exhausted',
    }))
  })
})
