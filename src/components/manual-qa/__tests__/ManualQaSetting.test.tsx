import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualQaSetting } from '../ManualQaSetting'
import { resolveManualQaSettingLabel } from '@/lib/manualQaSetting'

describe('ManualQaSetting', () => {
  it('offers inherit, enabled, and disabled choices', () => {
    const onChange = vi.fn()
    render(<ManualQaSetting idPrefix="qa" value={null} onChange={onChange} inheritedEnabled />)

    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Currently inherits Enabled.')).toHaveTextContent('Enabled')
    fireEvent.click(screen.getByRole('radio', { name: 'Disabled' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('resolves ticket, project, then global precedence', () => {
    expect(resolveManualQaSettingLabel(false, true, true)).toEqual({ enabled: false, source: 'ticket' })
    expect(resolveManualQaSettingLabel(null, true, false)).toEqual({ enabled: true, source: 'project' })
    expect(resolveManualQaSettingLabel(null, null, true)).toEqual({ enabled: true, source: 'profile' })
  })
})
