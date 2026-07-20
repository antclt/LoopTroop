import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutosaveStatus } from '../AutosaveStatus'

describe('AutosaveStatus', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows acknowledged relative and exact save times and refreshes the age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T12:00:20.000Z'))
    const savedAt = new Date('2026-07-20T12:00:00.000Z')

    render(<AutosaveStatus state="saved" lastSavedAt={savedAt} />)

    const status = screen.getByText(/Autosave on · Last save 20 seconds ago/)
    expect(status).toHaveAttribute('title', savedAt.toLocaleString())

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(status).toHaveTextContent('Last save 25 seconds ago')
  })

  it.each([
    ['pending', 'Changes save automatically'],
    ['saving', 'Saving…'],
    ['conflict', 'Autosave conflict'],
    ['error', 'Autosave failed'],
  ] as const)('renders the %s state', (state, message) => {
    render(<AutosaveStatus state={state} label="Draft autosave on" />)
    expect(screen.getByText(`Draft autosave on · ${message}`)).toBeInTheDocument()
  })

  it('supports a workflow-specific conflict message', () => {
    render(
      <AutosaveStatus
        state="conflict"
        conflictMessage="A newer draft must be reloaded"
      />,
    )
    expect(screen.getByText('Autosave on · A newer draft must be reloaded')).toBeInTheDocument()
  })
})
