import { createTicket as createTicketRecord } from '../storage/tickets'

export interface CreateTicketOptions {
  projectId: number
  title: string
  description?: string
  priority?: number
  manualQaOverride?: boolean | null
  gitHookPolicy?: 'validate_explicitly' | 'use_on_internal_commits' | 'ignore_internal_only' | null
}

export function createTicket(options: CreateTicketOptions) {
  return createTicketRecord(options)
}
