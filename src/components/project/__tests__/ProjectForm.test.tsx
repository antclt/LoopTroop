import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectForm } from '../ProjectForm'
import { TooltipProvider } from '@/components/ui/tooltip'

const mockProjectMutations = vi.hoisted(() => ({
  create: {
    mutate: vi.fn(),
    isPending: false,
    error: null as Error | null,
  },
  update: {
    mutate: vi.fn(),
    isPending: false,
    error: null as Error | null,
  },
  remove: {
    mutate: vi.fn(),
    isPending: false,
    error: null as Error | null,
  },
}))

vi.mock('@/hooks/useProjects', () => ({
  useCreateProject: () => mockProjectMutations.create,
  useUpdateProject: () => mockProjectMutations.update,
  useDeleteProject: () => mockProjectMutations.remove,
  useProjectWorktreesSize: () => ({
    data: undefined,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useDeleteProjectWorktrees: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/components/shared/useToast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: { manualQaEnabled: false } }),
}))

vi.mock('../FolderPicker', () => ({
  FolderPicker: ({ open }: { open: boolean }) => (open ? <div>Folder Picker</div> : null),
}))

vi.mock('../AppearancePickers', () => ({
  EmojiPickerSection: () => <div>Emoji Picker</div>,
  ColorPickerSection: () => <div>Color Picker</div>,
}))

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe('ProjectForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    mockProjectMutations.create.mutate.mockReset()
    mockProjectMutations.update.mutate.mockReset()
    mockProjectMutations.remove.mutate.mockReset()
    mockProjectMutations.create.error = null
    mockProjectMutations.update.error = null
  })

  it('shows the WSL mounted-drive warning returned by project path validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        isGit: true,
        status: 'valid',
        message: 'Git repository root selected',
        performanceWarning:
          'This project folder resolves to /mnt/d/work/app while LoopTroop is running in WSL. Windows-mounted drives can significantly degrade Git, scanning, and workflow performance. Prefer a copy under /home or another Linux filesystem path.',
      }),
    })))

    render(<ProjectForm onClose={vi.fn()} />, { wrapper: Wrapper })

    expect(screen.queryByRole('radio', { name: 'Inherit' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Disabled' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByLabelText(/Project Name/i), { target: { value: 'Mounted Repo' } })
    fireEvent.change(screen.getByLabelText(/Short Name/i), { target: { value: 'MNT' } })
    fireEvent.change(screen.getByLabelText(/Project Folder/i), { target: { value: '/mnt/d/work/app' } })

    await waitFor(() => {
      expect(screen.getByText('WSL mounted-drive warning')).toBeInTheDocument()
    })

    expect(screen.getByText(/resolves to \/mnt\/d\/work\/app while LoopTroop is running in WSL/i)).toBeInTheDocument()
  })

  it('shows the project-local .looptroop path in edit mode', async () => {
    render(
      <ProjectForm
        onClose={vi.fn()}
        project={{
          id: 1,
          name: 'LoopTroop',
          shortname: 'LOOP',
          icon: '📦',
          color: '#3b82f6',
          folderPath: '/home/liviu/LoopTroop',
          profileId: null,
          councilMembers: null,
          maxIterations: null,
          perIterationTimeout: null,
          executionSetupTimeout: null,
          councilResponseTimeout: null,
          minCouncilQuorum: null,
          interviewQuestions: null,
          ticketCounter: 4,
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-29T10:00:00.000Z',
        }}
      />, 
      { wrapper: Wrapper },
    )

    expect(screen.getByText('State Folder')).toBeInTheDocument()
    expect(screen.getByText('/home/liviu/LoopTroop/.looptroop')).toBeInTheDocument()

    fireEvent.focus(screen.getByRole('button', { name: 'State folder info' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent("LoopTroop keeps this project's local runtime state here.")
  })
})
