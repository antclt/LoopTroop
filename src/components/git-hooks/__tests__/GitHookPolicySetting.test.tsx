import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GitHookPolicySetting } from '../GitHookPolicySetting'
import { resolveGitHookPolicySetting } from '@/lib/gitHookPolicySetting'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderSetting() {
  const onChange = vi.fn()
  render(
    <TooltipProvider>
      <GitHookPolicySetting
        value={null}
        inheritedPolicy="ignore_internal_only"
        onChange={onChange}
      />
    </TooltipProvider>,
  )
  return onChange
}

describe('GitHookPolicySetting', () => {
  it('shows the inherited policy as one of three simple choices', () => {
    const onChange = renderSetting()

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Ignore' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Inherited default is selected/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Validate' }))
    expect(onChange).toHaveBeenCalledWith('validate_explicitly')
  })

  it.each([
    ['Validate', 'runs the approved validation commands as visible steps'],
    ['Ignore', 'does not run the explicit hook validation commands'],
    ['Run', 'A hook can block or modify those Git operations'],
  ])('explains the %s choice on hover', async (label, expectedText) => {
    renderSetting()
    fireEvent.focus(screen.getByRole('radio', { name: label }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(expectedText)
  })

  it('resolves ticket, project, then profile precedence', () => {
    expect(resolveGitHookPolicySetting('ignore_internal_only', 'use_on_internal_commits', 'validate_explicitly'))
      .toEqual({ policy: 'ignore_internal_only', source: 'ticket' })
    expect(resolveGitHookPolicySetting(null, 'use_on_internal_commits', 'validate_explicitly'))
      .toEqual({ policy: 'use_on_internal_commits', source: 'project' })
    expect(resolveGitHookPolicySetting(null, null, 'validate_explicitly'))
      .toEqual({ policy: 'validate_explicitly', source: 'profile' })
  })
})
