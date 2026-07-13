import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BeadDelimiter } from '../logGrouping'

describe('Manual QA log provenance', () => {
  it('renders QA origin details on a Coding bead delimiter', () => {
    render(<BeadDelimiter ordinal={2} total={3} title="Fix checkout" qaOrigin={{
      schemaVersion: 1,
      actionId: 'action-1',
      sourceTicketId: '1:APP-1',
      sourceTicketExternalId: 'APP-1',
      version: 2,
      imageDelivery: 'references_only',
      sourceItems: [{
        itemId: 'item-1',
        lineageId: 'checkout',
        behavior: 'Checkout submits',
        observation: 'Nothing happened',
        expectedResult: 'Order is created',
        evidence: [],
        links: [],
      }],
    }} />)

    expect(screen.getByLabelText('Bead 2/3')).toHaveTextContent('Manual QA Fix · v2')
    expect(screen.getByText(/Nothing happened/)).toBeInTheDocument()
    expect(screen.getByText(/Retry notes are recorded separately/)).toBeInTheDocument()
  })
})
