import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface LogCollapseToggleProps {
  isCollapsed: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
}

export function LogCollapseToggle({ isCollapsed, onToggle, showLabel, hideLabel }: LogCollapseToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={isCollapsed ? showLabel : hideLabel}
          onClick={onToggle}
          className="pr-1.5 pl-0.5 py-0.5 flex items-center justify-center hover:text-foreground transition-colors opacity-70 hover:opacity-100"
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-center text-balance">
        {isCollapsed ? showLabel : hideLabel}
      </TooltipContent>
    </Tooltip>
  )
}
