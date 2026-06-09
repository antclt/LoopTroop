import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UIProvider } from '../UIContext'
import { useUI } from '../useUI'

function UIStateProbe() {
  const { state } = useUI()

  return (
    <div>
      <span data-testid="search">{state.filters.search}</span>
      <span data-testid="project-filter">{state.filters.projectId ?? 'none'}</span>
    </div>
  )
}

describe('UIProvider', () => {
  it('normalizes persisted partial filter state from older browser sessions', () => {
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      activeView: 'kanban',
      filters: {
        projectId: 7,
      },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(screen.getByTestId('project-filter')).toHaveTextContent('7')
  })
})
