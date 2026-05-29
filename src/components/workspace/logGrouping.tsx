export function BeadDelimiter({ ordinal, total, title }: { ordinal: number; total: number; title?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-4 select-none" aria-label={`Bead ${ordinal}/${total}`}>
      <div className="flex-1 border-t border-border/40" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
        {`Bead ${ordinal}/${total}`}
      </span>
      {title ? (
        <span className="max-w-[45%] truncate text-[10px] text-muted-foreground/80">
          {title}
        </span>
      ) : null}
      <div className="flex-1 border-t border-border/40" />
    </div>
  )
}
