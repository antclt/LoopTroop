import { describe, expect, it } from 'vitest'
import { TEST, makeTicket } from '@/test/factories'
import { getDashboardSearchMatch, ticketMatchesDashboardSearch } from '../kanbanSearch'

const project = {
  name: 'LoopTroop Console',
  shortname: TEST.shortname,
}

describe('ticketMatchesDashboardSearch', () => {
  it('matches external ticket IDs case-insensitively and without punctuation', () => {
    const ticket = makeTicket({ externalId: `${TEST.shortname}-15`, title: 'Runtime cleanup' })

    expect(ticketMatchesDashboardSearch(ticket, project, `${TEST.shortname}-15`.toLocaleLowerCase())).toBe(true)
    expect(ticketMatchesDashboardSearch(ticket, project, `${TEST.shortname}15`)).toBe(true)
    expect(getDashboardSearchMatch(ticket, project, `${TEST.shortname}15`)?.label).toBe('ID match')
  })

  it('matches visible title and project metadata', () => {
    const ticket = makeTicket({ externalId: `${TEST.shortname}-16`, title: 'Improve dashboard search' })

    expect(ticketMatchesDashboardSearch(ticket, project, 'DASHBOARD')).toBe(true)
    expect(ticketMatchesDashboardSearch(ticket, project, 'looptroop')).toBe(true)
    expect(ticketMatchesDashboardSearch(ticket, project, TEST.shortname.toLocaleLowerCase())).toBe(true)
    expect(getDashboardSearchMatch(ticket, project, 'DASHBOARD')?.label).toBe('Title match')
    expect(getDashboardSearchMatch(ticket, project, 'looptroop')?.label).toBe('Project match')
  })

  it('matches ticket description content', () => {
    const ticket = makeTicket({
      externalId: `${TEST.shortname}-17`,
      title: 'Visible title',
      description: 'Hidden description phrase',
    })

    expect(ticketMatchesDashboardSearch(ticket, project, 'hidden description')).toBe(true)
    expect(getDashboardSearchMatch(ticket, project, 'hidden description')?.label).toBe('Description match')
  })

  it('does not match non-visible status or priority metadata', () => {
    const ticket = makeTicket({
      externalId: `${TEST.shortname}-18`,
      title: 'Visible title',
      priority: 1,
      status: 'COMPLETED',
    })

    expect(ticketMatchesDashboardSearch(ticket, project, 'completed')).toBe(false)
    expect(ticketMatchesDashboardSearch(ticket, project, 'very high')).toBe(false)
    expect(getDashboardSearchMatch(ticket, project, 'completed')).toBeNull()
  })
})
