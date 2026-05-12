import { DEFAULT_OPENCODE_TOKEN_BUDGET } from '../lib/constants'

// Token estimation and budget management

export const TOKEN_BUDGETS: Record<string, number> = {
  interview_draft: 80_000,
  interview_vote: DEFAULT_OPENCODE_TOKEN_BUDGET,
  interview_refine: DEFAULT_OPENCODE_TOKEN_BUDGET,
  interview_qa: 60_000,
  interview_coverage: 80_000,
  prd_draft: DEFAULT_OPENCODE_TOKEN_BUDGET,
  prd_vote: DEFAULT_OPENCODE_TOKEN_BUDGET,
  prd_refine: DEFAULT_OPENCODE_TOKEN_BUDGET,
  prd_coverage: 80_000,
  beads_draft: DEFAULT_OPENCODE_TOKEN_BUDGET,
  beads_vote: DEFAULT_OPENCODE_TOKEN_BUDGET,
  beads_refine: DEFAULT_OPENCODE_TOKEN_BUDGET,
  beads_coverage: 80_000,
  coding: 60_000,
  final_test: 80_000,
  preflight: 40_000,
}

export function getTokenBudget(phase: string): number {
  return TOKEN_BUDGETS[phase] ?? DEFAULT_OPENCODE_TOKEN_BUDGET
}
