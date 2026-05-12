import { CollapsibleSection } from './ArtifactContentViewer'
import type { CoverageApprovalWarningData } from './coverageApprovalWarningUtils'

export function CoverageApprovalWarning({
  warning,
}: {
  warning: CoverageApprovalWarningData
}) {
  return (
    <CollapsibleSection
      title={<span className="font-semibold">Coverage Warning</span>}
      className="border-amber-300 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20"
      triggerClassName="text-amber-950 hover:bg-amber-100/80 dark:text-amber-100 dark:hover:bg-amber-900/30"
      contentClassName="space-y-3 text-amber-950 dark:text-amber-100"
      scrollOnOpen={false}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30">
          {warning.summary}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Final Candidate
          </div>
          <div className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30">
            {warning.candidateLabel}
          </div>
        </div>

        {warning.gaps.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Remaining Gaps
            </div>
            <div className="space-y-2">
              {warning.gaps.map((gap, index) => (
                <div
                  key={`${gap}-${index}`}
                  className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30"
                >
                  {gap}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}
