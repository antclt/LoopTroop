import type { Ticket } from '@/hooks/useTickets'
import type { Project } from '@/hooks/useProjects'

type SearchableTicket = Pick<Ticket, 'externalId' | 'title' | 'description'>
type SearchableProject = Pick<Project, 'name' | 'shortname'>

export type DashboardSearchMatchField =
  | 'externalId'
  | 'title'
  | 'description'
  | 'projectName'
  | 'projectShortname'

export interface DashboardSearchMatch {
  fields: DashboardSearchMatchField[]
  label: string
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase()
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '')
}

const FIELD_LABELS: Record<DashboardSearchMatchField, string> = {
  externalId: 'ID match',
  title: 'Title match',
  description: 'Description match',
  projectName: 'Project match',
  projectShortname: 'Project match',
}

const FIELD_PRIORITY: DashboardSearchMatchField[] = [
  'externalId',
  'title',
  'description',
  'projectName',
  'projectShortname',
]

export function getDashboardSearchMatch(
  ticket: SearchableTicket,
  project: SearchableProject | undefined,
  query: string,
): DashboardSearchMatch | null {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) return null

  const compactQuery = compactSearchText(normalizedQuery)
  const searchableFields: Array<{ field: DashboardSearchMatchField; value: string }> = [
    { field: 'externalId', value: ticket.externalId },
    { field: 'title', value: ticket.title },
    { field: 'description', value: ticket.description ?? '' },
    { field: 'projectName', value: project?.name ?? '' },
    { field: 'projectShortname', value: project?.shortname ?? '' },
  ]

  const fields = searchableFields
    .filter(({ value }) => {
      const normalizedField = normalizeSearchText(value)
      if (normalizedField.includes(normalizedQuery)) return true
      return compactQuery.length > 0 && compactSearchText(value).includes(compactQuery)
    })
    .map(({ field }) => field)

  if (fields.length === 0) return null

  const primaryField = FIELD_PRIORITY.find((field) => fields.includes(field)) ?? fields[0]
  if (!primaryField) return null

  return {
    fields,
    label: FIELD_LABELS[primaryField],
  }
}

export function ticketMatchesDashboardSearch(
  ticket: SearchableTicket,
  project: SearchableProject | undefined,
  query: string,
): boolean {
  if (!query.trim()) return true
  return getDashboardSearchMatch(ticket, project, query) !== null
}
