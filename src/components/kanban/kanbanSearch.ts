import type { Ticket } from '@/hooks/useTickets'
import type { Project } from '@/hooks/useProjects'

type SearchableTicket = Pick<Ticket, 'externalId' | 'title' | 'description'>
type SearchableProject = Pick<Project, 'name' | 'shortname'>

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase()
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '')
}

export function ticketMatchesDashboardSearch(
  ticket: SearchableTicket,
  project: SearchableProject | undefined,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) return true

  const compactQuery = compactSearchText(normalizedQuery)
  const fields = [
    ticket.externalId,
    ticket.title,
    ticket.description ?? '',
    project?.name ?? '',
    project?.shortname ?? '',
  ]

  return fields.some((field) => {
    const normalizedField = normalizeSearchText(field)
    if (normalizedField.includes(normalizedQuery)) return true
    return compactQuery.length > 0 && compactSearchText(field).includes(compactQuery)
  })
}
