export type ManualQaOverride = boolean | null

export function resolveManualQaSettingLabel(
  override: ManualQaOverride,
  projectOverride: ManualQaOverride,
  globalEnabled: boolean,
): { enabled: boolean; source: 'ticket' | 'project' | 'profile' } {
  if (override !== null) return { enabled: override, source: 'ticket' }
  if (projectOverride !== null) return { enabled: projectOverride, source: 'project' }
  return { enabled: globalEnabled, source: 'profile' }
}
