import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  makeBeadsYaml,
  makeInterviewYaml,
  makePrdYaml,
} from '../../test/factories'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../test/integration'
import { getLatestPhaseArtifact, upsertLatestPhaseArtifact } from '../../storage/tickets'
import { updateProject } from '../../storage/projects'
import {
  buildPullRequestContext,
  buildPullRequestPrompt,
  completeMergedPullRequest,
  handleCreatePullRequest,
  isPullRequestLocalSyncError,
  readPullRequestReport,
} from '../phases/pullRequestPhase'

const mocks = vi.hoisted(() => ({
  runOpenCodePrompt: vi.fn(),
  runOpenCodeSessionPrompt: vi.fn(),
  pushBranchRef: vi.fn(),
  readGitDiff: vi.fn(),
  createOrUpdateDraftPullRequest: vi.fn(),
  captureGitRecoveryReceipt: vi.fn((input: unknown) => input),
  getPullRequestForBranch: vi.fn(),
  markPullRequestReady: vi.fn(),
  mergePullRequest: vi.fn(),
  syncLocalBaseBranch: vi.fn(),
  tryDeleteRemoteBranch: vi.fn(),
}))

vi.mock('../runOpenCodePrompt', () => ({
  runOpenCodePrompt: mocks.runOpenCodePrompt,
  runOpenCodeSessionPrompt: mocks.runOpenCodeSessionPrompt,
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../../git/push', () => ({
  pushBranchRef: mocks.pushBranchRef,
}))

vi.mock('../../git/github', () => ({
  readGitDiff: mocks.readGitDiff,
  createOrUpdateDraftPullRequest: mocks.createOrUpdateDraftPullRequest,
  captureGitRecoveryReceipt: mocks.captureGitRecoveryReceipt,
  getPullRequestForBranch: mocks.getPullRequestForBranch,
  markPullRequestReady: mocks.markPullRequestReady,
  mergePullRequest: mocks.mergePullRequest,
  syncLocalBaseBranch: mocks.syncLocalBaseBranch,
  tryDeleteRemoteBranch: mocks.tryDeleteRemoteBranch,
}))

describe('pull request drafting context', () => {
  const repoManager = createTestRepoManager('pull-request-phase-')

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readGitDiff.mockReturnValue({
      stat: '1 file changed, 2 insertions(+)',
      nameStatus: 'M\tsrc/example.ts',
      patch: 'diff --git a/src/example.ts b/src/example.ts',
      patchTruncated: false,
      patchError: null,
    })
    mocks.pushBranchRef.mockReturnValue({ pushed: true })
    mocks.createOrUpdateDraftPullRequest.mockReturnValue({
      number: 42,
      url: 'https://github.example/pulls/42',
      title: 'Draft PR',
      body: 'Body',
      state: 'draft',
      baseRefName: 'main',
      headRefName: 'TEST-1',
      headRefOid: 'candidate123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      mergedAt: null,
    })
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  function createPullRequestReadyTicket(overrides: { structuredRetryCount?: number } = {}) {
    const setup = createInitializedTestTicket(repoManager, {
      title: 'Draft concise PR',
      description: 'Explain the implementation without replaying planning context.',
    })

    writeFileSync(`${setup.paths.ticketDir}/prd.yaml`, makePrdYaml({
      ticketId: setup.ticket.externalId,
      problemStatement: 'Use PRD requirements as the reviewer-facing why.',
    }))
    upsertLatestPhaseArtifact(
      setup.ticket.id,
      'integration_report',
      'INTEGRATING_CHANGES',
      JSON.stringify({
        candidateCommitSha: 'candidate123',
        mergeBase: 'base123',
      }),
    )
    upsertLatestPhaseArtifact(
      setup.ticket.id,
      'final_test_report',
      'RUNNING_FINAL_TEST',
      JSON.stringify({ status: 'passed', summary: 'Final tests passed.' }),
    )

    return {
      ...setup,
      context: {
        ...setup.context,
        lockedStructuredRetryCount: overrides.structuredRetryCount ?? 1,
      },
    }
  }

  it('uses only ticket details and PRD as context while appending reports and diff sections explicitly', () => {
    resetTestDb()
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Draft concise PR',
      description: 'Explain the implementation without replaying planning context.',
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, makeInterviewYaml({ ticket_id: ticket.externalId }))
    writeFileSync(`${paths.ticketDir}/prd.yaml`, makePrdYaml({
      ticketId: ticket.externalId,
      problemStatement: 'Use PRD requirements as the reviewer-facing why.',
    }))
    writeFileSync(paths.beadsPath, makeBeadsYaml({ beadCount: 1 }))
    upsertLatestPhaseArtifact(
      ticket.id,
      'final_test_report',
      'RUNNING_FINAL_TEST',
      JSON.stringify({ status: 'passed', summary: 'Final tests passed.' }),
    )

    const { contextParts, finalTestReport } = buildPullRequestContext(
      ticket.id,
      context,
      ticket.description ?? '',
    )
    const prompt = buildPullRequestPrompt({
      fallbackTitle: `${ticket.externalId}: ${ticket.title}`,
      contextParts,
      integrationReport: '{"candidateCommitSha":"abc123"}',
      finalTestReport,
      diffStat: '1 file changed, 2 insertions(+)',
      diffNameStatus: 'M\tsrc/example.ts',
      diffPatch: 'diff --git a/src/example.ts b/src/example.ts',
    })

    expect(contextParts.map((part) => part.source)).toEqual(['ticket_details', 'prd'])
    expect(prompt).toContain('### ticket_details')
    expect(prompt).toContain('### prd')
    expect(prompt).toContain('Use PRD requirements as the reviewer-facing why.')
    expect(prompt).toContain('### integration_report')
    expect(prompt).toContain('### final_test_report')
    expect(prompt).toContain('Final tests passed.')
    expect(prompt).toContain('### final_diff_stat')
    expect(prompt).toContain('### final_diff_name_status')
    expect(prompt).toContain('### final_diff_patch')
    expect(prompt).not.toContain('artifact: interview')
    expect(prompt).not.toContain('beads:')
  })

  it('retries malformed PR drafts before push and PR side effects', async () => {
    resetTestDb()
    const { ticket, context, project } = createPullRequestReadyTicket({ structuredRetryCount: 1 })
    const sendEvent = vi.fn()
    updateProject(project.id, { councilResponseTimeout: 456_000 })

    mocks.runOpenCodePrompt.mockResolvedValueOnce({
      session: { id: 'pr-draft-1' },
      response: 'title: Missing sections',
      messages: [],
    })
    mocks.runOpenCodeSessionPrompt.mockResolvedValueOnce({
      session: { id: 'pr-draft-1' },
      response: [
        'title: Reviewer-friendly title',
        'summary:',
        '  - Summarized the implementation.',
        'why:',
        '  - The ticket requested this behavior.',
        'what_changed:',
        '  - Updated the relevant code path.',
        'validation:',
        '  - Final tests passed.',
        'follow_ups: []',
      ].join('\n'),
      messages: [],
    })

    await handleCreatePullRequest(ticket.id, context, sendEvent, new AbortController().signal)

    expect(mocks.runOpenCodePrompt).toHaveBeenCalledTimes(1)
    expect(mocks.runOpenCodeSessionPrompt).toHaveBeenCalledTimes(1)
    expect(mocks.runOpenCodePrompt).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 456_000,
      timeoutKind: 'ai_response',
      sessionOwnership: expect.objectContaining({
        phase: 'CREATING_PULL_REQUEST',
      }),
    }))
    expect(mocks.runOpenCodeSessionPrompt).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 456_000,
      timeoutKind: 'ai_response',
    }))
    expect(mocks.runOpenCodeSessionPrompt.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.pushBranchRef.mock.invocationCallOrder[0]!,
    )
    expect(mocks.pushBranchRef).toHaveBeenCalledTimes(1)
    expect(mocks.createOrUpdateDraftPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Reviewer-friendly title',
      body: expect.stringContaining('## Summary'),
    }))
    expect(sendEvent).toHaveBeenCalledWith({ type: 'PULL_REQUEST_READY' })

    const report = readPullRequestReport(ticket.id)
    expect(report?.structuredOutput?.autoRetryCount).toBe(1)
    expect(report?.rawAttempts).toEqual([
      expect.objectContaining({ attempt: 1, outcome: 'rejected' }),
      expect.objectContaining({ attempt: 2, outcome: 'accepted' }),
    ])
  })

  it('uses fallback PR text after parse retry exhaustion without blocking', async () => {
    resetTestDb()
    const { ticket, context } = createPullRequestReadyTicket({ structuredRetryCount: 0 })
    const sendEvent = vi.fn()

    mocks.runOpenCodePrompt.mockResolvedValueOnce({
      session: { id: 'pr-draft-fallback' },
      response: 'not: enough',
      messages: [],
    })

    await handleCreatePullRequest(ticket.id, context, sendEvent, new AbortController().signal)

    expect(mocks.runOpenCodeSessionPrompt).not.toHaveBeenCalled()
    expect(mocks.pushBranchRef).toHaveBeenCalledTimes(1)
    expect(mocks.createOrUpdateDraftPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      title: `${ticket.externalId}: ${ticket.title}`,
      body: expect.stringContaining('## Summary'),
    }))
    const report = readPullRequestReport(ticket.id)
    expect(report?.structuredOutput?.autoRetryCount).toBe(0)
    expect(report?.rawAttempts).toEqual([
      expect.objectContaining({ attempt: 1, outcome: 'rejected' }),
    ])
  })

  it('does not retry git push side effects after a valid PR draft', async () => {
    resetTestDb()
    const { ticket, context } = createPullRequestReadyTicket({ structuredRetryCount: 1 })

    mocks.runOpenCodePrompt.mockResolvedValueOnce({
      session: { id: 'pr-draft-valid' },
      response: [
        'title: Valid PR draft',
        'summary:',
        '  - Summarized the implementation.',
        'why:',
        '  - The ticket requested this behavior.',
        'what_changed:',
        '  - Updated the relevant code path.',
        'validation:',
        '  - Final tests passed.',
        'follow_ups: []',
      ].join('\n'),
      messages: [],
    })
    mocks.pushBranchRef.mockReturnValueOnce({ pushed: false, error: 'remote rejected push' })

    await expect(handleCreatePullRequest(
      ticket.id,
      context,
      vi.fn(),
      new AbortController().signal,
    )).rejects.toThrow('remote rejected push')

    expect(mocks.runOpenCodeSessionPrompt).not.toHaveBeenCalled()
    expect(mocks.pushBranchRef).toHaveBeenCalledTimes(1)
    expect(mocks.createOrUpdateDraftPullRequest).not.toHaveBeenCalled()
    expect(getLatestPhaseArtifact(ticket.id, 'git_recovery_receipt', 'CREATING_PULL_REQUEST')).toBeDefined()
  })

  it('records a merged PR separately when local base sync fails', () => {
    resetTestDb()
    const { ticket, context } = createInitializedTestTicket(repoManager, {
      title: 'Merge sync failure',
    })
    const prInfo = {
      number: 42,
      url: 'https://github.example/pulls/42',
      title: 'Merge sync failure',
      body: 'Body',
      state: 'open' as const,
      baseRefName: 'main',
      headRefName: ticket.externalId,
      headRefOid: 'candidate123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      mergedAt: null,
    }
    mocks.getPullRequestForBranch.mockReturnValue(prInfo)
    mocks.mergePullRequest.mockReturnValue({
      ...prInfo,
      state: 'merged',
      mergedAt: '2026-01-01T00:05:00.000Z',
    })
    mocks.syncLocalBaseBranch.mockImplementation(() => {
      throw new Error('Project worktree has uncommitted changes')
    })

    let thrown: unknown
    try {
      completeMergedPullRequest({
        ticketId: ticket.id,
        externalId: ticket.externalId,
        projectPath: context.externalId,
        baseBranch: 'main',
        headBranch: ticket.externalId,
        candidateCommitSha: 'candidate123',
        prReport: {
          status: 'passed',
          completedAt: '2026-01-01T00:00:00.000Z',
          baseBranch: 'main',
          headBranch: ticket.externalId,
          candidateCommitSha: 'candidate123',
          prNumber: 42,
          prUrl: prInfo.url,
          prState: 'open',
          prHeadSha: 'candidate123',
          title: prInfo.title,
          body: prInfo.body,
          createdAt: prInfo.createdAt,
          updatedAt: prInfo.updatedAt,
          mergedAt: null,
          closedAt: null,
          message: 'Draft PR ready.',
        },
      })
    } catch (error) {
      thrown = error
    }

    expect(isPullRequestLocalSyncError(thrown)).toBe(true)
    expect(mocks.mergePullRequest).toHaveBeenCalledOnce()
    expect(mocks.tryDeleteRemoteBranch).not.toHaveBeenCalled()
    const mergeReport = getLatestPhaseArtifact(ticket.id, 'merge_report', 'WAITING_PR_REVIEW')
    expect(JSON.parse(mergeReport!.content)).toMatchObject({
      status: 'local_sync_failed',
      disposition: 'merged',
      localSyncError: 'Project worktree has uncommitted changes',
    })
    expect(readPullRequestReport(ticket.id)).toMatchObject({
      prState: 'merged',
      message: expect.stringContaining('local sync failed for main'),
    })
  })
})
