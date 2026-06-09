import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { getTicketExternalIdLabel } from '@/lib/ticketDisplay'

interface TicketExternalIdProps {
  externalId: string
  isDisplayOnlyMock?: boolean | null
  className?: string
  markerClassName?: string
  style?: CSSProperties
}

export function TicketExternalId({
  externalId,
  isDisplayOnlyMock,
  className,
  markerClassName,
  style,
}: TicketExternalIdProps) {
  return (
    <span
      className={cn('inline', className)}
      style={style}
      aria-label={getTicketExternalIdLabel(externalId, isDisplayOnlyMock)}
    >
      <span>{externalId}</span>
      {isDisplayOnlyMock && (
        <sup
          aria-hidden="true"
          className={cn('ml-0.5 text-[0.7em] font-semibold leading-none align-super', markerClassName)}
        >
          (M)
        </sup>
      )}
    </span>
  )
}
