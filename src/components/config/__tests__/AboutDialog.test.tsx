import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AboutDialog } from '../AboutDialog'

vi.mock('@/hooks/useStartupStatus', () => ({
  useStartupStatus: () => ({
    data: {
      storage: {
        kind: 'restored',
        dbPath: '/home/liviu/.config/looptroop/app.sqlite',
        configDir: '/home/liviu/.config/looptroop',
        source: 'default',
        profileRestored: true,
        restoredProjectCount: 1,
        restoredProjects: [],
      },
      runtime: {
        isWsl: false,
        osLabel: 'Linux',
        appRoot: '/home/liviu/LoopTroop',
        appPathWarning: null,
      },
      ui: {
        restoreNotice: {
          shouldShow: false,
          dismissedAt: null,
        },
      },
    },
  }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
    ],
  }),
}))

describe('AboutDialog', () => {
  it('renders runtime and storage details with the professional labels', () => {
    render(<AboutDialog />)

    expect(screen.getByText('Runtime')).toBeInTheDocument()
    expect(screen.getByText('Operating System')).toBeInTheDocument()
    expect(screen.getByText('Linux')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('/home/liviu/.config/looptroop/app.sqlite')).toBeInTheDocument()
    expect(screen.getByText('/home/liviu/.config/looptroop')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('<repo>/.looptroop/')).toBeInTheDocument()
  })
})