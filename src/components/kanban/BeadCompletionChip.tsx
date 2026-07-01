import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ProgressRing } from './ProgressRing'

interface BeadCompletionChipProps {
  completedBeads?: number | null
  totalBeads: number
  percent: number
  className?: string
  showCount?: boolean
  showTooltip?: boolean
}

export function BeadCompletionChip({
  completedBeads,
  totalBeads,
  percent,
  className,
  showCount = false,
  showTooltip = true,
}: BeadCompletionChipProps) {
  if (!Number.isFinite(totalBeads) || totalBeads <= 0) return null
  const roundedPercent = Math.round(percent)
  const hasCount = typeof completedBeads === 'number' && Number.isFinite(completedBeads)
  const label = showCount && hasCount
    ? `${completedBeads}/${totalBeads} (${roundedPercent}%)`
    : `Beads ${roundedPercent}%`
  const chip = (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-emerald-300/80 bg-emerald-50 px-1.5 text-[10px] font-medium leading-none text-emerald-700 shadow-sm dark:border-emerald-800/80 dark:bg-emerald-950/35 dark:text-emerald-300',
        className,
      )}
    >
      <ProgressRing percent={roundedPercent} size={14} stroke={2.2} colorClass="text-emerald-500" />
      <span className="font-mono">{label}</span>
    </span>
  )

  if (!showTooltip) return chip

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {chip}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-center text-balance">
        Bead completion: completed beads divided by total beads. This is separate from workflow progress; remaining time is approximate.
      </TooltipContent>
    </Tooltip>
  )
}
