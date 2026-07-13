import { cn } from '@/lib/utils'
import type { ManualQaOverride } from '@/lib/manualQaSetting'

interface ManualQaSettingProps {
  value: ManualQaOverride
  onChange: (value: ManualQaOverride) => void
  disabled?: boolean
  idPrefix: string
  inheritedEnabled?: boolean
  compact?: boolean
}

const OPTIONS: Array<{ value: boolean; label: string }> = [
  { value: true, label: 'Enabled' },
  { value: false, label: 'Disabled' },
]

export function ManualQaSetting({
  value,
  onChange,
  disabled = false,
  idPrefix,
  inheritedEnabled,
  compact = false,
}: ManualQaSettingProps) {
  const selectedValue = value ?? inheritedEnabled ?? false

  return (
    <div>
      <div className="inline-flex rounded-md border border-input bg-muted/30 p-0.5" role="radiogroup" aria-label="Manual QA setting">
        {OPTIONS.map((option) => {
          const selected = option.value === selectedValue
          return (
            <button
              key={option.label}
              id={`${idPrefix}-${option.label.toLowerCase()}`}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                selected ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {!compact && value === null && typeof inheritedEnabled === 'boolean' && (
        <p className="mt-1 text-xs text-muted-foreground">
          Current default: <span className="font-medium text-foreground">{inheritedEnabled ? 'Enabled' : 'Disabled'}</span>. Choose an option to set this explicitly.
        </p>
      )}
    </div>
  )
}
