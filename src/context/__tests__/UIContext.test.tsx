import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { UIProvider } from '../UIContext'
import { useUI } from '../useUI'

function UIStateProbe() {
  const { state } = useUI()
  const presetScopes = Object.keys(state.presetsByProject)
  const globalPresetNames = Object.keys(state.presetsByProject['looptroop-presets-global'] ?? {})

  return (
    <div>
      <span data-testid="search">{state.filters.search}</span>
      <span data-testid="project-filter">{state.filters.projectId ?? 'none'}</span>
      <span data-testid="error-state">{state.filters.errorState}</span>
      <span data-testid="status-filter">{state.filters.status?.join(',') ?? 'none'}</span>
      <span data-testid="phase-filter">{state.filters.phase?.join(',') ?? 'none'}</span>
      <span data-testid="preset-scopes">{presetScopes.join('|')}</span>
      <span data-testid="global-presets">{globalPresetNames.join('|')}</span>
    </div>
  )
}

function PresetDispatchProbe() {
  const { state, dispatch } = useUI()
  const presetNames = Object.keys(state.presetsByProject['looptroop-presets-global'] ?? {})

  return (
    <div>
      <button
        type="button"
        onClick={() => dispatch({
          type: 'SET_PRESETS',
          presetKey: 'looptroop-presets-global',
          presets: {
            'Night ops': {
              priority: [1],
              stuckDays: 3,
              status: ['CODING'],
              phase: null,
              errorState: 'blocked',
              sortBy: 'priority_asc',
            },
          },
        })}
      >
        Save preset
      </button>
      <span data-testid="preset-names">{presetNames.join('|')}</span>
    </div>
  )
}

function ThemeDispatchProbe() {
  const { dispatch } = useUI()
  return (
    <button type="button" onClick={() => dispatch({ type: 'SET_THEME', theme: 'dark' })}>
      Set dark
    </button>
  )
}

describe('UIProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

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
    expect(screen.getByTestId('error-state')).toHaveTextContent('none')
  })

  it('migrates legacy onlyErrors:true to errorState "blocked"', () => {
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      filters: { onlyErrors: true },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('error-state')).toHaveTextContent('blocked')
  })

  it('drops legacy single-string status filter', () => {
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      filters: { status: 'CODING' },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('status-filter')).toHaveTextContent('none')
  })

  it('migrates legacy looptroop-presets-* keys into presetsByProject', () => {
    localStorage.setItem('looptroop-presets-global', JSON.stringify({
      'Night ops': { priority: [1], stuckDays: 3, onlyErrors: true, sortBy: 'priority_asc' },
    }))
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      filters: {},
      presetsByProject: {},
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('preset-scopes')).toHaveTextContent('looptroop-presets-global')
  })

  it('migrates legacy preset keys even before durable UI state exists', async () => {
    localStorage.setItem('looptroop-presets-global', JSON.stringify({
      'Night ops': { priority: [1], stuckDays: 3, onlyErrors: true, sortBy: 'priority_asc' },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('preset-scopes')).toHaveTextContent('looptroop-presets-global')
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('looptroop-ui-state') ?? '{}') as {
        presetsByProject?: Record<string, unknown>
      }
      expect(stored.presetsByProject).toHaveProperty('looptroop-presets-global')
    })
  })

  it('merges legacy preset keys into an existing persisted preset scope', () => {
    localStorage.setItem('looptroop-presets-global', JSON.stringify({
      'Night ops': { priority: [1], stuckDays: 3, onlyErrors: true, sortBy: 'priority_asc' },
    }))
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      filters: {},
      presetsByProject: {
        'looptroop-presets-global': {
          Existing: { priority: [2], stuckDays: null, errorState: 'none', sortBy: 'updatedAt_desc' },
        },
      },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('global-presets')).toHaveTextContent('Existing')
    expect(screen.getByTestId('global-presets')).toHaveTextContent('Night ops')
  })

  it('keeps valid presets when unrelated persisted UI fields are invalid', () => {
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      activeView: 'missing-view',
      logPanelHeight: 20,
      filters: { search: 42 },
      presetsByProject: {
        'looptroop-presets-global': {
          'Night ops': { priority: [1], stuckDays: 3, errorState: 'blocked', sortBy: 'priority_asc' },
        },
      },
    }))

    render(
      <UIProvider>
        <UIStateProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('global-presets')).toHaveTextContent('Night ops')
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('does not overwrite stored presets from a stale provider state during unrelated UI updates', () => {
    render(
      <UIProvider>
        <ThemeDispatchProbe />
      </UIProvider>,
    )
    localStorage.setItem('looptroop-ui-state', JSON.stringify({
      filters: {},
      presetsByProject: {
        'looptroop-presets-global': {
          'Night ops': { priority: [1], stuckDays: 3, errorState: 'blocked', sortBy: 'priority_asc' },
        },
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Set dark' }))

    const stored = JSON.parse(localStorage.getItem('looptroop-ui-state') ?? '{}') as {
      presetsByProject?: Record<string, Record<string, unknown>>
    }
    expect(stored.presetsByProject?.['looptroop-presets-global']).toHaveProperty('Night ops')
  })

  it('persists saved presets through a fresh provider boot', async () => {
    const { unmount } = render(
      <UIProvider>
        <PresetDispatchProbe />
      </UIProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))

    const stored = JSON.parse(localStorage.getItem('looptroop-ui-state') ?? '{}') as {
      presetsByProject?: Record<string, Record<string, unknown>>
    }
    expect(stored.presetsByProject?.['looptroop-presets-global']).toHaveProperty('Night ops')
    const mirrored = JSON.parse(localStorage.getItem('looptroop-presets-global') ?? '{}') as Record<string, unknown>
    expect(mirrored).toHaveProperty('Night ops')

    unmount()
    render(
      <UIProvider>
        <PresetDispatchProbe />
      </UIProvider>,
    )

    expect(screen.getByTestId('preset-names')).toHaveTextContent('Night ops')
  })
})
