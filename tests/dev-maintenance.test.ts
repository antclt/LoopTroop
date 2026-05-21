import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  chooseAgedDependencyTarget,
  collectLockfilePackageUpdates,
  decideDailyMaintenanceTask,
  formatDependencyReleasePolicySummary,
  evaluatePackageVersionReleaseAge,
  formatDependencyUpdateReleaseDetail,
  formatHeldAuditPackageUpdate,
  formatHeldDependencyReleaseDetail,
  getDependencyUpdateReleaseDetails,
  getHeldAuditPackageReleaseDetails,
  getHeldDependencyReleaseDetails,
  recordDailyMaintenanceSuccess,
  type DailyMaintenanceState,
} from '../scripts/dev-maintenance'

const tempDirs: string[] = []

function createState(): DailyMaintenanceState {
  return {
    version: 1,
    tasks: {},
  }
}

function makeTempFile(contents = 'x') {
  const dir = mkdtempSync(join(tmpdir(), 'looptroop-dev-maintenance-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'marker.txt')
  writeFileSync(filePath, contents, 'utf8')
  return filePath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('daily dev maintenance decisions', () => {
  it('runs when the task has never completed before', () => {
    const decision = decideDailyMaintenanceTask({
      taskName: 'audit',
      state: createState(),
      now: new Date('2026-04-23T10:00:00'),
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.reason).toBe('never-ran')
    expect(decision.deferred).toBe(false)
  })

  it('defers when the task already completed earlier on the same local day', () => {
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'opencode', new Date('2026-04-23T09:00:00'))

    const decision = decideDailyMaintenanceTask({
      taskName: 'opencode',
      state,
      now: new Date('2026-04-23T18:00:00'),
    })

    expect(decision.shouldRun).toBe(false)
    expect(decision.deferred).toBe(true)
    expect(decision.reason).toBe('already-ran-today')
    expect(decision.lastCompletedAt).toBeDefined()
    expect(decision.nextEligibleAt).toBeDefined()
  })

  it('runs again the same day when a watched file changed after the last completion', async () => {
    const markerPath = makeTempFile('before')
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'dependencySync', new Date('2026-04-23T09:00:00'))
    writeFileSync(markerPath, 'after', 'utf8')

    const decision = decideDailyMaintenanceTask({
      taskName: 'dependencySync',
      state,
      now: new Date('2026-04-23T18:00:00'),
      invalidatedByPaths: [markerPath],
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.deferred).toBe(false)
    expect(decision.reason).toBe('invalidated')
  })

  it('runs again on a new local day even without invalidation', () => {
    const state = createState()
    recordDailyMaintenanceSuccess(state, 'audit', new Date('2026-04-23T22:00:00'))

    const decision = decideDailyMaintenanceTask({
      taskName: 'audit',
      state,
      now: new Date('2026-04-24T09:00:00'),
    })

    expect(decision.shouldRun).toBe(true)
    expect(decision.reason).toBe('new-day')
    expect(decision.deferred).toBe(false)
  })
})

describe('aged dependency update selection', () => {
  const now = new Date('2026-05-12T12:00:00.000Z')

  it('chooses the newest newer stable version that has passed the release delay', () => {
    const selection = chooseAgedDependencyTarget({
      currentVersion: '1.0.0',
      latestVersion: '1.3.0',
      now,
      publishTimes: {
        '1.0.0': '2026-04-01T00:00:00.000Z',
        '1.1.0': '2026-05-01T00:00:00.000Z',
        '1.2.0': '2026-05-06T00:00:00.000Z',
        '1.3.0': '2026-05-10T00:00:00.000Z',
      },
    })

    expect(selection.targetVersion).toBe('1.1.0')
    expect(selection.nextEligibleAt).toBe('2026-05-13T00:00:00.000Z')
  })

  it('holds updates when every newer stable version is still inside the delay window', () => {
    const selection = chooseAgedDependencyTarget({
      currentVersion: '2.0.0',
      latestVersion: '2.2.0',
      now,
      publishTimes: {
        '2.0.0': '2026-04-01T00:00:00.000Z',
        '2.1.0': '2026-05-08T00:00:00.000Z',
        '2.2.0': '2026-05-11T00:00:00.000Z',
      },
    })

    expect(selection.targetVersion).toBeUndefined()
    expect(selection.reason).toBe('no-aged-version')
    expect(selection.nextEligibleAt).toBe('2026-05-15T00:00:00.000Z')
  })

  it('ignores prerelease versions when choosing an aged stable target', () => {
    const selection = chooseAgedDependencyTarget({
      currentVersion: '3.0.0',
      latestVersion: '3.2.0',
      now,
      publishTimes: {
        '3.1.0-beta.1': '2026-04-01T00:00:00.000Z',
        '3.1.0': '2026-05-01T00:00:00.000Z',
        '3.2.0': '2026-05-11T00:00:00.000Z',
      },
    })

    expect(selection.targetVersion).toBe('3.1.0')
  })

  it('allows OpenCode-scoped updates to bypass the release delay', () => {
    const selection = chooseAgedDependencyTarget({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      now,
      bypassAgeGate: true,
      publishTimes: {
        '1.1.0': '2026-05-12T11:00:00.000Z',
      },
    })

    expect(selection.targetVersion).toBe('1.1.0')
  })
})

describe('audit lockfile age gating', () => {
  const now = new Date('2026-05-12T12:00:00.000Z')

  it('extracts proposed package version changes from npm audit lockfile previews', () => {
    const currentLock = JSON.stringify({
      packages: {
        '': { name: 'looptroop' },
        'node_modules/plain': { version: '1.0.0' },
        'node_modules/@scope/pkg': { version: '2.0.0' },
      },
    })
    const proposedLock = JSON.stringify({
      packages: {
        '': { name: 'looptroop' },
        'node_modules/plain': { version: '1.1.0' },
        'node_modules/@scope/pkg': { version: '2.0.0' },
        'node_modules/wrapped/node_modules/nested': { version: '3.0.0' },
      },
    })

    const result = collectLockfilePackageUpdates(currentLock, proposedLock)

    expect(result.errors).toEqual([])
    expect(result.updates).toEqual([
      { name: 'nested', version: '3.0.0', currentVersion: undefined },
      { name: 'plain', version: '1.1.0', currentVersion: '1.0.0' },
    ])
  })

  it('marks proposed audit fix versions as held until their release delay passes', () => {
    const releaseAge = evaluatePackageVersionReleaseAge({
      version: '4.2.0',
      now,
      publishTimes: {
        '4.2.0': '2026-05-10T12:00:00.000Z',
      },
    })

    expect(releaseAge.eligible).toBe(false)
    expect(releaseAge.reason).toBe('too-new')
    expect(releaseAge.nextEligibleAt).toBe('2026-05-17T12:00:00.000Z')
  })

  it('allows proposed audit fix versions that are old enough', () => {
    const releaseAge = evaluatePackageVersionReleaseAge({
      version: '4.1.0',
      now,
      publishTimes: {
        '4.1.0': '2026-05-01T12:00:00.000Z',
      },
    })

    expect(releaseAge.eligible).toBe(true)
  })
})

describe('held dependency detail formatting', () => {
  it('describes the release-age policy used by dev startup messaging', () => {
    expect(formatDependencyReleasePolicySummary()).toBe(
      'Direct npm dependency and audit updates are held until releases are 7 days old; OpenCode updates immediately.',
    )
  })

  it('lists updated direct dependencies with package type and version movement', () => {
    const details = getDependencyUpdateReleaseDetails({
      updatedDependencies: ['alpha'],
      updatedDevDependencies: ['beta'],
      updatedDependencyDetails: [
        {
          name: 'alpha',
          current: '1.0.0',
          target: '1.1.0',
          bypassedAgeGate: false,
        },
      ],
      updatedDevDependencyDetails: [
        {
          name: 'beta',
          current: '2.0.0',
          target: '2.1.0',
          bypassedAgeGate: false,
        },
      ],
    })

    expect(details.map(formatDependencyUpdateReleaseDetail)).toEqual([
      'updated runtime dependency alpha 1.0.0 -> 1.1.0',
      'updated dev dependency beta 2.0.0 -> 2.1.0',
    ])
  })

  it('lists held direct dependencies with package type, versions, and eligibility time', () => {
    const details = getHeldDependencyReleaseDetails({
      heldDependencies: [
        {
          name: 'alpha',
          current: '1.0.0',
          latest: '1.1.0',
          nextEligibleAt: '2026-05-15T00:00:00.000Z',
          reason: 'no-aged-version',
        },
      ],
      heldDevDependencies: [
        {
          name: 'beta',
          current: '2.0.0',
          latest: '2.1.0',
          reason: 'metadata-unavailable',
        },
      ],
    })

    expect(details.map(formatHeldDependencyReleaseDetail)).toEqual([
      'held runtime dependency alpha 1.0.0 -> 1.1.0; until 2026-05-15T00:00:00.000Z',
      'held dev dependency beta 2.0.0 -> 2.1.0; until npm publish metadata can be verified',
    ])
  })

  it('lists held audit packages with proposed versions and eligibility time', () => {
    const details = getHeldAuditPackageReleaseDetails([
      {
        name: 'beta',
        version: '2.1.0',
        currentVersion: '2.0.0',
        nextEligibleAt: '2026-05-16T00:00:00.000Z',
        reason: 'too-new',
      },
    ])

    expect(details.map(formatHeldAuditPackageUpdate)).toEqual([
      'held audit fix beta 2.0.0 -> 2.1.0; until 2026-05-16T00:00:00.000Z',
    ])
  })
})
