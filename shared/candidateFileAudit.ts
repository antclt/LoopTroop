export const CANDIDATE_FILE_AUDIT_ARTIFACT = 'candidate_file_audit'
export const CANDIDATE_DIFF_ARTIFACT = 'candidate_diff'

export type CandidateFileDecision = 'include' | 'exclude' | 'review'

export interface CandidateFileAuditEntry {
  path: string
  decision: CandidateFileDecision
  reason: string
}

export interface CandidateFileAuditSummary {
  totalFiles: number
  includedFiles: number
  excludedFiles: number
  reviewedFiles: number
}

export interface CandidateFileAuditReport {
  status: 'passed' | 'fallback'
  auditedAt: string
  baseCommit: string
  originalCandidateCommitSha: string
  candidateCommitSha: string | null
  includedFiles: string[]
  excludedFiles: string[]
  reviewedFiles: string[]
  entries: CandidateFileAuditEntry[]
  stats: CandidateFileAuditSummary
  message: string
  warnings?: string[]
}
