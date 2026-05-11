import { describe, expect, it } from 'vitest'
import { parseInterviewQuestions } from '../interviewQuestions'

describe('shared interview question parsing', () => {
  it('rejects malformed entries inside a structured questions collection', () => {
    const content = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: Structure',
      '    rationale: "Missing the actual question text."',
    ].join('\n')

    expect(() => parseInterviewQuestions(content)).toThrow(
      /structured questions collection contains malformed entries at 2/,
    )
  })
})
