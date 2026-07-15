import { describe, expect, it } from 'vitest'
import { isVersionOnlyWorkspaceProbeCommand } from '../workspaceProbe'

describe('isVersionOnlyWorkspaceProbeCommand', () => {
  it.each([
    'node --version',
    'python -V',
    'ruby -v',
    'go version',
    './runtime/tool -version 2>/dev/null',
  ])('rejects version-only probe %s', (command) => {
    expect(isVersionOnlyWorkspaceProbeCommand(command)).toBe(true)
  })

  it.each([
    'npm test -- --listTests',
    'cargo metadata --no-deps',
    'python -m pytest --collect-only',
    'tool --version && project check',
  ])('accepts functional project probe %s', (command) => {
    expect(isVersionOnlyWorkspaceProbeCommand(command)).toBe(false)
  })
})
