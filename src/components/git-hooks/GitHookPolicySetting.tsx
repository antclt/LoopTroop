import type { GitHookPolicy } from '@/lib/executionSetupPlan'
import type { GitHookPolicyOverride } from '@/lib/gitHookPolicySetting'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GitHookPolicySettingProps {
  value: GitHookPolicyOverride
  onChange: (value: GitHookPolicy) => void
  inheritedPolicy?: GitHookPolicy
  disabled?: boolean
  compact?: boolean
}

const OPTIONS: Array<{ value: GitHookPolicy; label: string; tooltip: string }> = [
  {
    value: 'validate_explicitly',
    label: 'Validate',
    tooltip: 'LoopTroop bypasses repository hooks on its own commits and pushes. It discovers hook-related checks during setup and runs the approved validation commands as visible steps. Those commands run again before integration, so failures are captured without hiding inside Git. This is the recommended default.',
  },
  {
    value: 'ignore_internal_only',
    label: 'Ignore',
    tooltip: 'LoopTroop bypasses repository hooks on its own commits and pushes. It does not run the explicit hook validation commands during setup or integration. The skip is recorded in the ticket artifacts for auditability. Your own Git commands and repository hook files are unchanged.',
  },
  {
    value: 'use_on_internal_commits',
    label: 'Run',
    tooltip: 'LoopTroop lets Git execute repository hooks normally on its internal commits and pushes. A hook can block or modify those Git operations just as it would for your own command. LoopTroop does not add separate hook-equivalent validation commands for this policy. Use it when the hooks themselves are safe and reliable in the ticket worktree.',
  },
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
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
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
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs leading-relaxed">
                {option.tooltip}
              </TooltipContent>
            </Tooltip>
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
