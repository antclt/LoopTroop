import type { GitHookPolicy } from '@/lib/executionSetupPlan'
import type { GitHookPolicyOverride } from '@/lib/gitHookPolicySetting'
import { cn } from '@/lib/utils'

interface GitHookPolicySettingProps {
  value: GitHookPolicyOverride
  onChange: (value: GitHookPolicy) => void
  inheritedPolicy?: GitHookPolicy
  disabled?: boolean
  compact?: boolean
}

const OPTIONS: Array<{ value: GitHookPolicy; label: string }> = [
  { value: 'validate_explicitly', label: 'Validate' },
  { value: 'ignore_internal_only', label: 'Ignore' },
  { value: 'use_on_internal_commits', label: 'Run' },
]

export function GitHookPolicySetting({
  value,
  onChange,
  inheritedPolicy = 'validate_explicitly',
  disabled = false,
  compact = false,
}: GitHookPolicySettingProps) {
  const selectedValue = value ?? inheritedPolicy

  return (
    <div>
      <div
        className="inline-flex rounded-md border border-input bg-muted/30 p-0.5"
        role="radiogroup"
        aria-label="Git hook policy"
      >
        {OPTIONS.map((option) => {
          const selected = option.value === selectedValue
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-label={option.label}
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
      {!compact && value === null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Inherited default is selected. Choose a button to override it here.
        </p>
      )}
    </div>
  )
}
