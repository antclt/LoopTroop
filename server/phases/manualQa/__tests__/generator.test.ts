import { describe, expect, it } from 'vitest'
import type { TicketContext } from '../../../machines/types'
import type { PrdDocument } from '../../../structuredOutput/types'
import { buildGenerationPrompt } from '../generator'

describe('Manual QA generation context', () => {
  it('includes focused ticket, bead verification, and previous result context', () => {
    const prompt = buildGenerationPrompt({
      context: {
        externalId: 'DEMO-1',
        title: 'Persist filters',
      } as TicketContext,
      ticketDescription: 'Remember the selected filters between visits.',
      prd: { epics: [] } as unknown as PrdDocument,
      beads: [{
        id: 'DEMO-1.1',
        title: 'Persist selection',
        description: 'Store and restore the filter.',
        prdRefs: [],
        targetFiles: ['src/filter.ts'],
        acceptanceCriteria: ['Selection survives reload'],
        tests: ['Reload persistence regression'],
        labels: ['filters'],
        issueType: 'feature',
      }],
      finalTestReport: 'All automated tests passed.',
      previousQa: {
        checklist: { version: 1, items: [{ id: 'qa-v1-001', lineageId: 'filter-selection' }] },
        results: { results: [{ itemId: 'qa-v1-001', outcome: 'fail', observation: 'Reset after reload' }] },
      },
      diffMetadata: 'M src/filter.ts',
    })

    expect(prompt).toContain('Remember the selected filters between visits.')
    expect(prompt).toContain('Reload persistence regression')
    expect(prompt).toContain('"issueType": "feature"')
    expect(prompt).toContain('Reset after reload')
    expect(prompt).toContain('title: concise human-facing check title')
  })
})
