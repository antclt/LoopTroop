import { cn } from '@/lib/utils'
import { Coins, Flame, Brain, Maximize2, Gift, Settings } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface OpenRouterRoutingPickerProps {
  value: string | undefined // current suffix, e.g. "", ":floor", ":nitro"
  onChange: (suffix: string) => void
  disabled?: boolean
}

const ROUTING_OPTIONS = [
  { 
    value: '', 
    label: 'Default', 
    icon: Settings, 
    colorClass: 'text-slate-500 dark:text-slate-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-slate-100 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Default provider routing' 
  },
  { 
    value: ':floor', 
    label: 'Floor', 
    icon: Coins, 
    colorClass: 'text-emerald-600 dark:text-emerald-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Cost focus: Route to the cheapest provider' 
  },
  { 
    value: ':nitro', 
    label: 'Nitro', 
    icon: Flame, 
    colorClass: 'text-orange-600 dark:text-orange-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-orange-100 text-orange-800 ring-1 ring-orange-400 dark:bg-orange-950/60 dark:text-orange-200 dark:ring-orange-800' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Speed focus: Route to the fastest provider' 
  },
  { 
    value: ':thinking', 
    label: 'Thinking', 
    icon: Brain, 
    colorClass: 'text-purple-600 dark:text-purple-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-purple-100 text-purple-800 ring-1 ring-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:ring-purple-800' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Reasoning focus: Enable chain-of-thought outputs' 
  },
  { 
    value: ':extended', 
    label: 'Extended', 
    icon: Maximize2, 
    colorClass: 'text-blue-600 dark:text-blue-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:ring-blue-800' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Context focus: Prioritize providers supporting longer context' 
  },
  { 
    value: ':free', 
    label: 'Free', 
    icon: Gift, 
    colorClass: 'text-sky-600 dark:text-sky-400', 
    intensityColor: (selected: boolean) => selected 
      ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-800' 
      : 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground', 
    description: 'Free tier focus: Force routing to free providers only' 
  }
] as const

export function OpenRouterRoutingPicker({ value = '', onChange, disabled }: OpenRouterRoutingPickerProps) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase shrink-0">Routing:</span>
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/30 p-0.5">
        {ROUTING_OPTIONS.map(opt => {
          const Icon = opt.icon
          const selected = value === opt.value
          return (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(opt.value)}
                  className={cn(
                    'relative px-2 py-0.5 text-xs font-medium rounded-md transition-all duration-200 cursor-pointer select-none',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    opt.intensityColor(selected),
                    selected && 'shadow-sm scale-[1.02]',
                  )}
                >
                  <span className="flex items-center gap-1 text-[10px]">
                    <Icon className={cn("h-3 w-3", opt.colorClass)} />
                    <span>{opt.label}</span>
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-center text-balance">{opt.description}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
