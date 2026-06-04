import { cn } from '@/lib/utils'

export type TicketDescriptionMode = 'markdown' | 'raw'

interface TicketDescriptionTabsProps {
  mode: TicketDescriptionMode
  onModeChange: (mode: TicketDescriptionMode) => void
  className?: string
}

const tabs: Array<{ id: TicketDescriptionMode; label: string }> = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'raw', label: 'Raw' },
]

export function TicketDescriptionTabs({ mode, onModeChange, className }: TicketDescriptionTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Description view"
      className={cn('inline-flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-background p-0.5', className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={mode === tab.id}
          className={cn(
            'h-6 rounded px-2 text-[11px] font-medium leading-none transition-colors',
            mode === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          onClick={() => onModeChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
