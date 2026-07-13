import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_MANUAL_QA_EVIDENCE_BYTES,
  ManualQaEvidenceLinkSchema,
} from '../types'
import {
  completeManualQaReservation,
  getManualQaStoragePaths,
  getManualQaEvidenceRelativePath,
  isSafeRasterMediaType,
  persistManualQaEvidenceActionReceipt,
  readManualQaEvidenceActionReceipt,
  reserveManualQaVersion,
  resolveManualQaEvidence,
  sanitizeEvidenceName,
  streamManualQaEvidence,
} from '../storage'
import { buildImprovementDescription } from '../operations'
import { reserveManualQaSubmissionOperation } from '../operations'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root() {
  const value = mkdtempSync(join(tmpdir(), 'looptroop-manual-qa-'))
  roots.push(value)
  return value
}

function byteStream(value: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(value)
      controller.close()
    },
  })
}

describe('Manual QA canonical storage', () => {
  it('reuses a durable generation reservation after restart', () => {
    const ticketDir = root()
    const first = reserveManualQaVersion(ticketDir, '1:DEMO-1', 1, 'generation:one')
    const restored = reserveManualQaVersion(ticketDir, '1:DEMO-1', 1, 'generation:two')
    expect(restored).toEqual(first)
    completeManualQaReservation(ticketDir, first, 'a'.repeat(64))
    expect(JSON.parse(readFileSync(getManualQaStoragePaths(ticketDir, 1).reservationPath, 'utf8'))).toMatchObject({
      state: 'complete',
      checklistHash: 'a'.repeat(64),
    })
  })

  it('streams evidence into an item-contained directory and makes action retries idempotent', async () => {
    const ticketDir = root()
    const evidence = await streamManualQaEvidence({
      ticketDir,
      version: 1,
      itemId: 'qa-v1-001',
      evidenceId: 'evidence:one',
      originalName: '../../screen.png',
      mediaType: 'image/png',
      body: byteStream(new Uint8Array([137, 80, 78, 71])),
    })
    expect(evidence.originalName).toBe('screen.png')
    expect(evidence.storedName).toMatch(/^item-qa-v1-001\//)
    expect(evidence.inlinePreview).toBe(true)
    expect(resolveManualQaEvidence({ ticketDir, version: 1, itemId: 'qa-v1-001', evidenceId: evidence.id }).path)
      .toContain('/manual-qa/v1/evidence/item-qa-v1-001/')
    expect(getManualQaEvidenceRelativePath(1, evidence)).toBe(`manual-qa/v1/evidence/${evidence.storedName}`)

    const receipt = persistManualQaEvidenceActionReceipt(ticketDir, 1, 'upload:one', 'upload', evidence)
    expect(persistManualQaEvidenceActionReceipt(ticketDir, 1, 'upload:one', 'upload', evidence)).toEqual(receipt)
    expect(readManualQaEvidenceActionReceipt(ticketDir, 1, 'upload:one')?.evidence.id).toBe(evidence.id)
  })

  it('enforces the evidence safety contract and link protocols', () => {
    expect(MAX_MANUAL_QA_EVIDENCE_BYTES).toBe(250 * 1024 * 1024)
    expect(sanitizeEvidenceName('..\\..\\evil\u0000.exe')).toBe('evil.exe')
    expect(isSafeRasterMediaType('image/webp')).toBe(true)
    expect(isSafeRasterMediaType('image/svg+xml')).toBe(false)
    expect(ManualQaEvidenceLinkSchema.safeParse({ id: 'link:1', url: 'https://example.com/evidence' }).success).toBe(true)
    expect(ManualQaEvidenceLinkSchema.safeParse({ id: 'link:1', url: 'file:///tmp/evidence' }).success).toBe(false)
    expect(ManualQaEvidenceLinkSchema.safeParse({ id: 'link:1', url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('retains deterministic Manual QA context and reports truncation omissions', () => {
    const result = buildImprovementDescription({
      description: 'A'.repeat(12_000),
      sourceExternalId: 'DEMO-1',
      version: 3,
      itemId: 'qa-v3-002',
      behavior: 'The filter should preserve selection',
      source: 'implementation',
      expectedResult: 'Selection remains after reload',
      actions: ['Choose a filter', 'Reload'],
      improvementTitle: 'Remember the selected filter',
      userNote: 'This would reduce repetitive setup.',
      evidence: [],
      links: [{ url: 'https://example.com/note', label: 'Reference' }],
      prdRefs: ['EPIC-1/US-1/AC-1 (partial)'],
      beadRefs: ['DEMO-1.2'],
    })
    expect(result.description.length).toBeLessThanOrEqual(10_000)
    expect(result.description).toContain('## Manual QA Context')
    expect(result.description).toContain('This ticket was created from a reviewed Manual QA improvement.')
    expect(result.omittedFields).toContain('userEditedDescription')
  })

  it('reuses submission operations by action ID and rejects conflicting retries', () => {
    const path = join(root(), 'manual-qa', 'v1', 'submission-operation.json')
    const first = reserveManualQaSubmissionOperation({
      path,
      actionId: 'submit:one',
      ticketId: '1:DEMO-1',
      version: 1,
      checklistHash: 'a'.repeat(64),
      draftRevision: 4,
    })
    expect(reserveManualQaSubmissionOperation({
      path,
      actionId: 'submit:one',
      ticketId: '1:DEMO-1',
      version: 1,
      checklistHash: 'a'.repeat(64),
      draftRevision: 4,
    })).toEqual(first)
    expect(() => reserveManualQaSubmissionOperation({
      path,
      actionId: 'submit:one',
      ticketId: '1:DEMO-1',
      version: 1,
      checklistHash: 'b'.repeat(64),
      draftRevision: 4,
    })).toThrow('different input')
  })
})
