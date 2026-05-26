import type { ExecutionSetupProfile } from './types'
import { EXECUTION_SETUP_RUNTIME_DIR } from './types'

export const EXECUTION_SETUP_RUN_WRAPPER = `${EXECUTION_SETUP_RUNTIME_DIR}/run`

export function normalizeExecutionSetupCommandPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

export function commandMentionsExecutionSetupWrapper(command: string, wrapperPath: string = EXECUTION_SETUP_RUN_WRAPPER): boolean {
  const normalizedCommand = normalizeExecutionSetupCommandPath(command)
  const normalizedWrapper = normalizeExecutionSetupCommandPath(wrapperPath)
  return normalizedCommand.includes(normalizedWrapper)
}

export function getExecutionSetupCommandWrapper(profile: ExecutionSetupProfile | null | undefined): string | null {
  if (!profile) return null

  const explicitWrapper = profile.reusableArtifacts.find((artifact) => artifact.kind === 'command-wrapper' && artifact.path.trim())
  if (explicitWrapper) return explicitWrapper.path

  const wrapperArtifact = profile.reusableArtifacts.find((artifact) => (
    artifact.path.trim()
    && normalizeExecutionSetupCommandPath(artifact.path) === EXECUTION_SETUP_RUN_WRAPPER
  ))
  if (wrapperArtifact) return wrapperArtifact.path

  const projectCommands = [
    ...profile.projectCommands.prepare,
    ...profile.projectCommands.testFull,
    ...profile.projectCommands.lintFull,
    ...profile.projectCommands.typecheckFull,
  ]
  return projectCommands.some((command) => commandMentionsExecutionSetupWrapper(command))
    ? EXECUTION_SETUP_RUN_WRAPPER
    : null
}

export function hasExecutionSetupProjectCommands(profile: ExecutionSetupProfile | null | undefined): boolean {
  if (!profile) return false
  return [
    profile.projectCommands.prepare,
    profile.projectCommands.testFull,
    profile.projectCommands.lintFull,
    profile.projectCommands.typecheckFull,
  ].some((commands) => commands.some((command) => command.trim().length > 0))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getValueByAliases(record: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (alias in record) return record[alias]
  }
  return undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function getRawProjectCommands(record: Record<string, unknown>): string[] {
  const rawProjectCommands = getValueByAliases(record, ['projectCommands', 'project_commands'])
  if (!isRecord(rawProjectCommands)) return []
  return [
    ...toStringArray(getValueByAliases(rawProjectCommands, ['prepare'])),
    ...toStringArray(getValueByAliases(rawProjectCommands, ['testFull', 'test_full'])),
    ...toStringArray(getValueByAliases(rawProjectCommands, ['lintFull', 'lint_full'])),
    ...toStringArray(getValueByAliases(rawProjectCommands, ['typecheckFull', 'typecheck_full'])),
  ]
}

export function getExecutionSetupCommandWrapperFromRecord(record: Record<string, unknown>): string | null {
  const profileRecord = isRecord(getValueByAliases(record, ['profile']))
    ? getValueByAliases(record, ['profile']) as Record<string, unknown>
    : record
  const artifacts = getValueByAliases(profileRecord, ['reusableArtifacts', 'reusable_artifacts'])
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      if (!isRecord(artifact)) continue
      const path = typeof artifact.path === 'string' ? artifact.path.trim() : ''
      const kind = typeof artifact.kind === 'string' ? artifact.kind.trim() : ''
      if (path && kind === 'command-wrapper') return path
    }
    for (const artifact of artifacts) {
      if (!isRecord(artifact)) continue
      const path = typeof artifact.path === 'string' ? artifact.path.trim() : ''
      if (path && normalizeExecutionSetupCommandPath(path) === EXECUTION_SETUP_RUN_WRAPPER) return path
    }
  }

  return getRawProjectCommands(profileRecord).some((command) => commandMentionsExecutionSetupWrapper(command))
    ? EXECUTION_SETUP_RUN_WRAPPER
    : null
}

export function getExecutionSetupCommandWrapperFromContent(content: string | undefined | null): string | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as unknown
    return isRecord(parsed) ? getExecutionSetupCommandWrapperFromRecord(parsed) : null
  } catch {
    return null
  }
}
