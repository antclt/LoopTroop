import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualQaSetting } from '../ManualQaSetting'
import { resolveManualQaSettingLabel } from '@/lib/manualQaSetting'

describe('ManualQaSetting', () => {
  it('offers only enabled and disabled while resolving legacy defaults', () => {
    const onChange = vi.fn()
    render(<ManualQaSetting idPrefix="qa" value={null} onChange={onChange} inheritedEnabled />)

    expect(screen.queryByRole('radio', { name: 'Inherit' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Current default:/)).toHaveTextContent('Enabled')
    fireEvent.click(screen.getByRole('radio', { name: 'Disabled' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('resolves ticket, project, then global precedence', () => {
    expect(resolveManualQaSettingLabel(false, true, true)).toEqual({ enabled: false, source: 'ticket' })
    expect(resolveManualQaSettingLabel(null, true, false)).toEqual({ enabled: true, source: 'project' })
    expect(resolveManualQaSettingLabel(null, null, true)).toEqual({ enabled: true, source: 'profile' })
  })
})
