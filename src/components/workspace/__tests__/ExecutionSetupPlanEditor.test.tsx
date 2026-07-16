import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionSetupPlan } from '@/lib/executionSetupPlan'
import { ExecutionSetupPlanEditor } from '../ExecutionSetupPlanEditor'

function buildPlan(): ExecutionSetupPlan {
  return {
    schemaVersion: 2,
    ticketId: 'TEST-1',
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary: 'Verify the workspace.',
    readiness: { status: 'ready', actionsRequired: false, evidence: [], gaps: [] },
    tempRoots: [],
    workspaceInputs: [],
    workspaceProbes: [{ id: 'workspace', command: 'project test --list', purpose: 'Load the project.' }],
    gitHooks: {
      policy: 'validate_explicitly',
      detected: [{ name: 'pre-commit', path: '.husky/pre-commit', source: 'husky', executable: true, managerHint: 'husky' }],
      validationCommands: [
        { id: 'lint', hook: 'pre-commit', command: 'project lint', purpose: 'Run lint.' },
        { id: 'test', hook: 'pre-commit', command: 'project test', purpose: 'Run tests.' },
      ],
    },
    steps: [],
    projectCommands: { prepare: [], testFull: [], lintFull: [], typecheckFull: [] },
    qualityGatePolicy: { tests: '', lint: '', typecheck: '', fullProjectFallback: '' },
    cautions: [],
  }
}

describe('ExecutionSetupPlanEditor workspace verification', () => {
  it('keeps discovered hooks read-only and allows validation commands to be edited, reordered, and removed', () => {
    const onChange = vi.fn()
    const plan = buildPlan()
    const { rerender } = render(<ExecutionSetupPlanEditor plan={plan} onChange={onChange} />)

    expect(screen.getByText('Detected Git Hooks (read-only)')).toBeInTheDocument()
    expect(screen.getByText('.husky/pre-commit')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('.husky/pre-commit')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Move Git Hook Validation Commands 2 up' }))
    const reordered = onChange.mock.calls.at(-1)?.[0] as ExecutionSetupPlan
    expect(reordered.gitHooks.validationCommands.map((entry) => entry.id)).toEqual(['test', 'lint'])

    rerender(<ExecutionSetupPlanEditor plan={reordered} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Git Hook Validation Commands 1 command'), { target: { value: 'project test --all' } })
    expect((onChange.mock.calls.at(-1)?.[0] as ExecutionSetupPlan).gitHooks.validationCommands.at(0)?.command).toBe('project test --all')

    let current = onChange.mock.calls.at(-1)?.[0] as ExecutionSetupPlan
    rerender(<ExecutionSetupPlanEditor plan={current} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Git Hook Validation Commands 1' }))
    current = onChange.mock.calls.at(-1)?.[0] as ExecutionSetupPlan
    rerender(<ExecutionSetupPlanEditor plan={current} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Git Hook Validation Commands 1' }))
    expect((onChange.mock.calls.at(-1)?.[0] as ExecutionSetupPlan).gitHooks.validationCommands).toEqual([])
  })
})
