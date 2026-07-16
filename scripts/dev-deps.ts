import {
  ensureInstallIfNeeded,
  formatDependencyUpdateReleaseDetail,
  formatHeldDependencyReleaseDetail,
  getDependencyUpdateReleaseDetails,
  getHeldDependencyReleaseDetails,
  getMissingBins,
  readDailyMaintenanceState,
  recordDailyMaintenanceSuccess,
  syncDirectDependencies,
  writeDailyMaintenanceState,
} from './dev-maintenance'

const install = ensureInstallIfNeeded()
if (install.errors.length > 0) {
  for (const error of install.errors) {
    console.error(`[deps:sync] ${error}`)
  }
  process.exit(1)
}

const report = syncDirectDependencies({ skip: process.env.LOOPTROOP_DEV_SKIP_DEPS === '1' })
if (report.skipped) {
  console.log('[deps:sync] Skipped direct dependency sync because LOOPTROOP_DEV_SKIP_DEPS=1.')
  process.exit(0)
}

if (report.errors.length > 0) {
  for (const error of report.errors) {
    console.error(`[deps:sync] ${error}`)
  }
  process.exit(1)
}

if (report.alreadyCurrent) {
  console.log('[deps:sync] All direct dependencies are already on the latest stable releases.')
} else if (report.updatedDependencies.length === 0 && report.updatedDevDependencies.length === 0) {
  const heldCount = report.heldDependencies.length + report.heldDevDependencies.length
  console.log(
    `[deps:sync] Held ${heldCount} newer direct dependency ` +
    `${heldCount === 1 ? 'release' : 'releases'} behind release-age or compatibility gates.`,
  )
  for (const held of getHeldDependencyReleaseDetails(report)) {
    console.log(`[deps:sync] - ${formatHeldDependencyReleaseDetail(held)}`)
  }
} else {
  const heldCount = report.heldDependencies.length + report.heldDevDependencies.length
  console.log(
    `[deps:sync] Updated ${report.updatedDependencies.length} runtime and ` +
    `${report.updatedDevDependencies.length} dev dependencies to eligible stable releases` +
    (heldCount > 0 ? `; held ${heldCount} newer ${heldCount === 1 ? 'release' : 'releases'}.` : '.'),
  )
  for (const update of getDependencyUpdateReleaseDetails(report)) {
    console.log(`[deps:sync] - ${formatDependencyUpdateReleaseDetail(update)}`)
  }
  for (const held of getHeldDependencyReleaseDetails(report)) {
    console.log(`[deps:sync] - ${formatHeldDependencyReleaseDetail(held)}`)
  }
}

const missingBins = getMissingBins()
if (missingBins.length > 0) {
  console.error(`[deps:sync] Missing local dev binaries after sync: ${missingBins.join(', ')}`)
  process.exit(1)
}

const maintenanceState = readDailyMaintenanceState()
recordDailyMaintenanceSuccess(maintenanceState, 'dependencySync')
writeDailyMaintenanceState(maintenanceState)
