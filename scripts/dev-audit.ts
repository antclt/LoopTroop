import {
  formatHeldAuditPackageUpdate,
  getHeldAuditPackageReleaseDetails,
  readDailyMaintenanceState,
  recordDailyMaintenanceSuccess,
  remediateAudit,
  writeDailyMaintenanceState,
} from './dev-maintenance'

const report = remediateAudit({
  verbose: process.env.LOOPTROOP_DEV_VERBOSE === '1',
  skip: process.env.LOOPTROOP_DEV_SKIP_DEPS === '1',
})

if (report.skipped) {
  console.log('[audit:remediate] Skipped audit remediation because LOOPTROOP_DEV_SKIP_DEPS=1.')
  process.exit(0)
}

if (report.fixHeld) {
  console.log(
    `[audit:remediate] Held npm audit fix because ${report.heldPackageUpdates.length} proposed ` +
    `${report.heldPackageUpdates.length === 1 ? 'package release is' : 'package releases are'} inside the 7-day delay.`,
  )
  for (const held of getHeldAuditPackageReleaseDetails(report.heldPackageUpdates)) {
    console.log(`[audit:remediate] - ${formatHeldAuditPackageUpdate(held)}`)
  }
} else if (report.fixChanged) {
  console.log('[audit:remediate] npm audit fix updated the dependency graph.')
} else {
  console.log('[audit:remediate] npm audit fix made no dependency changes.')
}

if (report.unresolved.length > 0) {
  console.log(
    `[audit:remediate] Remaining audit findings: ${report.totals.total} ` +
    `(high=${report.totals.high}, moderate=${report.totals.moderate}).`,
  )
  for (const issue of report.unresolved) {
    console.log(`[audit:remediate] - ${issue.name} (${issue.severity})${issue.note ? `: ${issue.note}` : ''}`)
  }
} else {
  console.log('[audit:remediate] No remaining npm audit findings.')
}

if (report.errors.length > 0) {
  for (const error of report.errors) {
    console.error(`[audit:remediate] ${error}`)
  }
  process.exit(1)
}

const maintenanceState = readDailyMaintenanceState()
recordDailyMaintenanceSuccess(maintenanceState, 'audit')
writeDailyMaintenanceState(maintenanceState)
