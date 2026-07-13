export interface BeadDependencies {
  blocked_by: string[]
  blocks: string[]
}

export interface BeadContextGuidance {
  patterns: string[]
  anti_patterns: string[]
}

export interface QaOriginEvidenceRef {
  id: string
  originalName: string
  mediaType: string
  size: number
  sha256: string
  relativePath: string
}

export interface QaOriginSourceItem {
  itemId: string
  lineageId: string
  behavior: string
  observation: string
  expectedResult: string
  evidence: QaOriginEvidenceRef[]
  links: Array<{ id: string; url: string; label?: string }>
}

export interface QaOrigin {
  schemaVersion: 1
  actionId: string
  sourceTicketId: string
  sourceTicketExternalId: string
  version: number
  sourceItems: QaOriginSourceItem[]
  imageDelivery?: 'attached' | 'references_only'
}

export interface Bead {
  // Subset fields (draft phase — PROM20)
  id: string                              // Field 1 (draft uses simple kebab-case; PROM25 assigns hierarchical ID)
  title: string                           // Field 2
  prdRefs: string[]                       // Field 7 — PRD epic/story references
  description: string                     // Field 9
  contextGuidance: BeadContextGuidance    // Field 10 — patterns and anti-patterns
  acceptanceCriteria: string[]            // Field 11
  tests: string[]                         // Field 14
  testCommands: string[]                  // Field 15

  // Expanded fields (terminal expansion phase — PROM25)
  priority: number                        // Field 3 — sequential execution order
  status: 'pending' | 'in_progress' | 'done' | 'error'  // Field 4
  issueType: string                       // Field 5 — "task", "bug", "chore", etc.
  externalRef: string                     // Field 6 — parent ticket ID
  labels: string[]                        // Field 8 — must map to at least one epic and story
  dependencies: BeadDependencies          // Field 12 — blocked_by + blocks
  targetFiles: string[]                   // Field 13
  notes: string                           // Field 16 — append-only, empty on first attempt
  iteration: number                       // Field 17 — starts at 1 for the first execution attempt
  createdAt: string                       // Field 18 — set when beads are approved
  updatedAt: string                       // Field 19
  completedAt: string                     // Field 20 — filled when status=done
  startedAt: string                       // Field 21 — set on first iteration, preserved across retries
  beadStartCommit: string | null          // Field 22 — git SHA for worktree reset
  qaOrigin?: QaOrigin                     // Typed Manual QA provenance; retry notes remain in notes.
}

export type BeadSubset = Pick<Bead, 'id' | 'title' | 'prdRefs' | 'description' | 'contextGuidance' | 'acceptanceCriteria' | 'tests' | 'testCommands'>
