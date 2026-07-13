import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitializedTestTicket, createTestRepoManager, resetTestDb } from '../../../test/integration'
import {
  getLatestPhaseArtifact,
  getTicketByRef,
  getTicketPaths,
  insertPhaseArtifact,
  listPhaseAttempts,
  patchTicket,
} from '../../../storage/tickets'
import {
  buildFinalTestFileEffectsAudit,
  captureFinalTestDirtyFiles,
} from '../../finalTest/fileEffectsAudit'
import { prepareManualQaCheckpoint } from '../checkpoint'
import { reserveManualQaSubmissionOperation, skipManualQa, submitManualQa } from '../operations'
import {
  getManualQaChecklistHash,
  getManualQaStoragePaths,
  persistManualQaChecklist,
  persistManualQaResults,
  persistManualQaSummary,
  readManualQaResults,
  streamManualQaEvidence,
} from '../storage'
import type { ManualQaChecklist, ManualQaDraft, ManualQaSummary } from '../types'

const repoManager = createTestRepoManager('manual-qa-operations-')

function checklistItem(id: string, required = true): ManualQaChecklist['items'][number] {
  return {
    id,
    lineageId: `lineage-${id}`,
    priorItemIds: [],
    title: `Verify ${id}`,
    source: 'implementation',
    behavior: `${id} remains usable`,
    severity: 'high',
    required,
    recheckState: 'pending',
    prerequisites: [],
    actions: [`Exercise ${id}`],
    expectedResult: `${id} works`,
    watchNotes: [],
    beadRefs: [],
    prdRefs: [],
  }
}

function prepareFixture(items = [checklistItem('item-one')]) {
  const setup = createInitializedTestTicket(repoManager, { title: 'Manual QA submission' })
  const clean = captureFinalTestDirtyFiles(setup.paths.worktreePath)
  insertPhaseArtifact(setup.ticket.id, {
    phase: 'RUNNING_FINAL_TEST',
    artifactType: 'final_test_file_effects_audit',
    content: JSON.stringify(buildFinalTestFileEffectsAudit({
      baselineDirtyFiles: clean,
      dirtyFilesAfterTesting: clean,
      declaredEffects: [],
    })),
  })
  prepareManualQaCheckpoint(setup.ticket.id, 1)
  persistManualQaChecklist(setup.paths.ticketDir, {
    schemaVersion: 1,
    artifact: 'manual_qa_checklist',
    ticketId: setup.ticket.externalId,
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: 'Verify the implemented behavior.',
    items,
  })
  const checklistHash = getManualQaChecklistHash(setup.paths.ticketDir, 1)!
  patchTicket(setup.ticket.id, { status: 'WAITING_MANUAL_QA' })
  insertPhaseArtifact(setup.ticket.id, {
    phase: 'UI_STATE',
    artifactType: 'ui_state:manual_qa_draft:v1',
    content: JSON.stringify({ revision: 1, data: {} }),
  })
  const draft: ManualQaDraft = {
    schemaVersion: 1,
    artifact: 'manual_qa_draft',
    ticketId: setup.ticket.externalId,
    version: 1,
    checklistHash,
    draftRevision: 1,
    results: items.map((item) => ({
      itemId: item.id,
      outcome: 'pass',
      note: '',
      observation: '',
      reason: '',
      evidenceIds: [],
      links: [],
    })),
    improvements: [],
    evidence: [],
    updatedAt: new Date().toISOString(),
  }
  return {
    ...setup,
    draft,
    guard: { actionId: 'submit-one', operationType: 'submit' as const, expectedChecklistHash: checklistHash, expectedDraftRevision: 1 },
  }
}

function byteStream(value: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(value)
      controller.close()
    },
  })
}

function terminalSummary(
  setup: ReturnType<typeof prepareFixture>,
  outcome: 'passed' | 'skipped',
  skipReason?: string,
): ManualQaSummary {
  return {
    schemaVersion: 1,
    artifact: 'manual_qa_summary',
    ticketId: setup.ticket.externalId,
    version: 1,
    outcome,
    createdFixBeadIds: [],
    improvementTicketIds: [],
    waivedItemIds: [],
    waivedItems: [],
    ...(skipReason ? { skipReason } : {}),
    startedAt: '2026-07-13T12:00:00.000Z',
    completedAt: '2026-07-13T12:01:00.000Z',
    durationMs: 60_000,
    itemCounts: { pass: 1, fail: 0, waive: 0, improvement: 0, pending: 0 },
    requiredItemCount: 1,
    optionalItemCount: 0,
    evidenceCount: 0,
    nextAction: 'integrate',
    coverage: { covered: 0, partiallyCovered: 0, uncovered: 0 },
    modelCapability: null,
  }
}

describe('Manual QA submission recovery and integrity', () => {
  beforeEach(() => resetTestDb())
  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('persists top-level summary artifacts and re-dispatches a durable untransitioned outcome', async () => {
    const setup = prepareFixture()
    const firstEvent = vi.fn()
    const summary = await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: firstEvent,
    })
    expect(summary.outcome).toBe('passed')
    expect(summary).toMatchObject({
      itemCounts: { pass: 1, fail: 0, waive: 0, improvement: 0, pending: 0 },
      requiredItemCount: 1,
      optionalItemCount: 0,
      evidenceCount: 0,
      nextAction: 'integrate',
      coverage: { covered: 0, partiallyCovered: 0, uncovered: 0 },
    })
    expect(summary.durationMs).toBeGreaterThanOrEqual(0)
    expect(summary.modelCapability).toMatchObject({ imageEvidenceMode: 'references_only' })
    expect(firstEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_COMPLETE' })
    const artifact = getLatestPhaseArtifact(setup.ticket.id, 'manual_qa_summary', 'WAITING_MANUAL_QA')
    expect(JSON.parse(artifact!.content)).toMatchObject({ version: 1, outcome: 'passed' })

    const recoveryEvent = vi.fn()
    const recovered = await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: recoveryEvent,
    })
    expect(recovered).toEqual(summary)
    expect(recoveryEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_COMPLETE' })

    const operationPath = getManualQaStoragePaths(setup.paths.ticketDir, 1).operationPath
    const interruptedJournal = JSON.parse(readFileSync(operationPath, 'utf8'))
    writeFileSync(operationPath, JSON.stringify({ ...interruptedJournal, state: 'creating_beads' }, null, 2))
    await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })
    expect(JSON.parse(readFileSync(operationPath, 'utf8')).state).toBe('complete')
  })

  it('repairs a missing phase summary before replaying a canonical terminal outcome', async () => {
    const setup = prepareFixture()
    persistManualQaSummary(setup.paths.ticketDir, terminalSummary(setup, 'passed'))

    const sendEvent = vi.fn()
    await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent,
    })

    const artifact = getLatestPhaseArtifact(setup.ticket.id, 'manual_qa_summary', 'WAITING_MANUAL_QA')
    expect(JSON.parse(artifact!.content)).toMatchObject({ version: 1, outcome: 'passed' })
    expect(sendEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_COMPLETE' })
  })

  it('repairs missing skip and summary phase artifacts after a terminal skip crash window', async () => {
    const setup = prepareFixture()
    const paths = getManualQaStoragePaths(setup.paths.ticketDir, 1)
    const actionId = 'skip-crash-window'
    reserveManualQaSubmissionOperation({
      path: paths.operationPath,
      actionId,
      operationType: 'skip',
      ticketId: setup.ticket.id,
      version: 1,
      checklistHash: setup.guard.expectedChecklistHash,
      draftRevision: 1,
    })
    writeFileSync(paths.skipReceiptPath, [
      'schemaVersion: 1',
      'artifact: manual_qa_skip_receipt',
      `ticketId: ${JSON.stringify(setup.ticket.externalId)}`,
      'version: 1',
      `actionId: ${JSON.stringify(actionId)}`,
      'reason: "Recovered skip"',
      'createdAt: "2026-07-13T12:01:00.000Z"',
      '',
    ].join('\n'))
    persistManualQaSummary(setup.paths.ticketDir, terminalSummary(setup, 'skipped', 'Recovered skip'))

    const sendEvent = vi.fn()
    await skipManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: { ...setup.guard, actionId, operationType: 'skip' },
      reason: 'Recovered skip',
      sendEvent,
    })

    expect(JSON.parse(getLatestPhaseArtifact(
      setup.ticket.id,
      'manual_qa_summary',
      'WAITING_MANUAL_QA',
    )!.content)).toMatchObject({ version: 1, outcome: 'skipped' })
    expect(JSON.parse(getLatestPhaseArtifact(
      setup.ticket.id,
      'manual_qa_skip_receipt',
      'WAITING_MANUAL_QA',
    )!.content)).toMatchObject({ actionId, version: 1, reason: 'Recovered skip' })
    expect(JSON.parse(readFileSync(paths.operationPath, 'utf8')).state).toBe('complete')
    expect(sendEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_SKIPPED' })
  })

  it('rejects a conflicting operation before writing canonical submission results', async () => {
    const setup = prepareFixture()
    const paths = getManualQaStoragePaths(setup.paths.ticketDir, 1)
    reserveManualQaSubmissionOperation({
      path: paths.operationPath,
      actionId: 'another-action',
      operationType: 'submit',
      ticketId: setup.ticket.id,
      version: 1,
      checklistHash: setup.guard.expectedChecklistHash,
      draftRevision: 1,
    })

    await expect(submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })).rejects.toThrow('different input')
    expect(existsSync(paths.resultsPath)).toBe(false)
  })

  it('rejects invalid action IDs before reserving an operation', async () => {
    const setup = prepareFixture()
    const operationPath = getManualQaStoragePaths(setup.paths.ticketDir, 1).operationPath
    await expect(submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: { ...setup.guard, actionId: 'invalid action id' },
      sendEvent: vi.fn(),
    })).rejects.toThrow('valid action ID')
    expect(existsSync(operationPath)).toBe(false)
  })

  it('reuses the immutable canonical results snapshot on a partial-operation retry', async () => {
    const setup = prepareFixture()
    const paths = getManualQaStoragePaths(setup.paths.ticketDir, 1)
    reserveManualQaSubmissionOperation({
      path: paths.operationPath,
      actionId: setup.guard.actionId,
      operationType: 'submit',
      ticketId: setup.ticket.id,
      version: 1,
      checklistHash: setup.guard.expectedChecklistHash,
      draftRevision: 1,
    })
    persistManualQaResults(setup.paths.ticketDir, {
      ...setup.draft,
      artifact: 'manual_qa_results',
      actionId: setup.guard.actionId,
      submittedAt: '2026-07-13T12:00:00.000Z',
    })

    await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })
    expect(readManualQaResults(setup.paths.ticketDir, 1)?.submittedAt).toBe('2026-07-13T12:00:00.000Z')
  })

  it('supports required waiver, optional pending, and skip completion paths', async () => {
    const waived = prepareFixture()
    waived.draft.results[0] = { ...waived.draft.results[0]!, outcome: 'waive', reason: 'Accepted for this delivery.' }
    expect((await submitManualQa({
      ticketId: waived.ticket.id,
      version: 1,
      draft: waived.draft,
      guard: waived.guard,
      sendEvent: vi.fn(),
    })).outcome).toBe('waived_through')

    const optional = prepareFixture([checklistItem('optional-pending', false)])
    optional.draft.results[0] = { ...optional.draft.results[0]!, outcome: 'pending' }
    expect((await submitManualQa({
      ticketId: optional.ticket.id,
      version: 1,
      draft: optional.draft,
      guard: optional.guard,
      sendEvent: vi.fn(),
    })).outcome).toBe('passed')

    const skipped = prepareFixture()
    const skipEvent = vi.fn()
    const skippedSummary = await skipManualQa({
      ticketId: skipped.ticket.id,
      version: 1,
      draft: skipped.draft,
      guard: { ...skipped.guard, actionId: 'skip-one', operationType: 'skip' },
      reason: 'Verified separately.',
      sendEvent: skipEvent,
    })
    expect(skippedSummary).toMatchObject({
      outcome: 'skipped',
      skipReason: 'Verified separately.',
      modelCapability: { imageEvidenceMode: 'references_only' },
    })
    expect(skipEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_SKIPPED' })
  })

  it('resumes a failed round without duplicating fresh phase attempts', async () => {
    const setup = prepareFixture()
    setup.draft.results[0] = {
      ...setup.draft.results[0]!,
      outcome: 'fail',
      observation: 'The behavior did not work.',
    }
    const firstEvent = vi.fn()
    const summary = await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: firstEvent,
    })
    expect(summary.outcome).toBe('created_fixes')
    expect(firstEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_FIXES_CREATED' })
    const attemptCounts = Object.fromEntries(
      ['RUNNING_FINAL_TEST', 'GENERATING_QA_CHECKLIST', 'WAITING_MANUAL_QA']
        .map((phase) => [phase, listPhaseAttempts(setup.ticket.id, phase).length]),
    )

    const recoveryEvent = vi.fn()
    await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: recoveryEvent,
    })
    expect(recoveryEvent).toHaveBeenCalledWith({ type: 'MANUAL_QA_FIXES_CREATED' })
    for (const [phase, count] of Object.entries(attemptCounts)) {
      expect(listPhaseAttempts(setup.ticket.id, phase)).toHaveLength(count)
    }
  })

  it('rejects evidence attached to a different checklist item', async () => {
    const setup = prepareFixture([checklistItem('item-one'), checklistItem('item-two')])
    const evidence = await streamManualQaEvidence({
      ticketDir: setup.paths.ticketDir,
      version: 1,
      itemId: 'item-two',
      evidenceId: 'evidence-two',
      originalName: 'observation.txt',
      mediaType: 'text/plain',
      body: byteStream(new TextEncoder().encode('Observed item two')),
    })
    setup.draft.evidence = [evidence]
    setup.draft.results[0]!.evidenceIds = [evidence.id]

    await expect(submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })).rejects.toThrow('does not belong to checklist item item-one')
  })

  it('creates one restart-idempotent improvement ticket with structured-only provenance', async () => {
    const item = checklistItem('optional-improvement', false)
    item.title = 'Remember the chosen value'
    item.behavior = 'The chosen value can be reused on a future visit'
    item.actions = ['Choose a value and reload the page']
    item.expectedResult = 'The chosen value remains selected after reload'
    const setup = prepareFixture([item])
    setup.draft.results[0] = {
      ...setup.draft.results[0]!,
      outcome: 'improvement',
      note: 'Remember this choice for future visits.',
      improvementDraftId: 'improvement-one',
    }
    setup.draft.improvements = [{
      id: 'improvement-one',
      itemId: 'optional-improvement',
      title: 'Persist the choice',
      description: 'Keep the chosen value after reload.',
      evidenceIds: [],
    }]
    const summary = await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })
    expect(summary.improvementTicketIds).toHaveLength(1)
    const childId = summary.improvementTicketIds[0]!
    const child = getTicketByRef(childId)!
    expect(child.description).toContain('## Manual QA Context')
    expect(child.description).not.toContain('optional-improvement')
    const childPaths = getTicketPaths(childId)!
    const origin = JSON.parse(readFileSync(resolve(childPaths.ticketDir, 'meta', 'manual-qa-origin.json'), 'utf8'))
    expect(origin).toMatchObject({
      source: 'manual_qa_improvement',
      sourceItemIds: ['optional-improvement'],
      resultType: 'improvement',
      evidenceRefs: [],
    })
    const retried = await submitManualQa({
      ticketId: setup.ticket.id,
      version: 1,
      draft: setup.draft,
      guard: setup.guard,
      sendEvent: vi.fn(),
    })
    expect(retried.improvementTicketIds).toEqual([childId])
  })
})
