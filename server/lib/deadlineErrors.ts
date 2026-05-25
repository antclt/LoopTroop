export type DeadlineScope = 'opencode' | 'workflow'

export interface WorkflowDeadlineTimeoutDetails {
  phase?: string
  beadId?: string
  iteration?: number
  timeoutMs?: number
}

export class WorkflowDeadlineTimeoutError extends Error {
  readonly phase?: string
  readonly beadId?: string
  readonly iteration?: number
  readonly timeoutMs?: number

  constructor(details: WorkflowDeadlineTimeoutDetails = {}) {
    const subject = details.phase === 'CODING' && details.beadId && details.iteration
      ? `Iteration timeout for bead ${details.beadId} attempt ${details.iteration}`
      : 'Workflow deadline timeout'
    super(details.timeoutMs && details.timeoutMs > 0
      ? `${subject} after ${details.timeoutMs}ms`
      : subject)
    this.name = 'WorkflowDeadlineTimeoutError'
    this.phase = details.phase
    this.beadId = details.beadId
    this.iteration = details.iteration
    this.timeoutMs = details.timeoutMs
  }
}

export function isWorkflowDeadlineTimeoutError(error: unknown): error is WorkflowDeadlineTimeoutError {
  return error instanceof WorkflowDeadlineTimeoutError
    || (
      typeof error === 'object'
      && error !== null
      && 'name' in error
      && (error as { name?: unknown }).name === 'WorkflowDeadlineTimeoutError'
    )
}
