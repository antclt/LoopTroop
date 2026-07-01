import { describe, expect, it } from 'vitest'
import { getBeadCompletionProgress, getStatusProgress, getWorkflowRingProgress } from '../ticketCardUtils'

describe('getWorkflowRingProgress', () => {
  it('uses workflow-phase progress during CODING', () => {
    expect(getWorkflowRingProgress('CODING')).toEqual({
      percent: getStatusProgress('CODING'),
      label: 'Workflow progress',
    })
  })

  it('uses workflow-phase progress outside execution', () => {
    expect(getWorkflowRingProgress('DRAFTING_PRD')).toEqual({
      percent: getStatusProgress('DRAFTING_PRD'),
      label: 'Workflow progress',
    })
  })

  it('returns null when the status has no meaningful workflow progress', () => {
    expect(getWorkflowRingProgress('DRAFT')).toBeNull()
    expect(getWorkflowRingProgress('NOT_A_STATUS')).toBeNull()
  })
})

describe('getBeadCompletionProgress', () => {
  it('reflects deterministic bead completion during CODING', () => {
    expect(getBeadCompletionProgress('CODING', { totalBeads: 8, percentComplete: 50 })).toEqual({
      percent: 50,
      label: 'Bead completion',
    })
  })

  it('rounds the bead percentage', () => {
    expect(getBeadCompletionProgress('CODING', { totalBeads: 8, percentComplete: 37.5 })?.percent).toBe(38)
  })

  it('returns null outside CODING or before beads exist', () => {
    expect(getBeadCompletionProgress('CODING', { totalBeads: 0, percentComplete: 0 })).toBeNull()
    expect(getBeadCompletionProgress('DRAFTING_PRD', { totalBeads: 5, percentComplete: 20 })).toBeNull()
  })
})
