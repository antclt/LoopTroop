import { describe, expect, it } from 'vitest'
import {
  OPENCODE_ALLOW_ALL_PERMISSION_VALUE,
  OPENCODE_PERMISSION,
  withOpenCodePermissionEnv,
} from '../scripts/opencode-permission-env'

describe('withOpenCodePermissionEnv', () => {
  it('sets OpenCode permissions to allow-all by default', () => {
    const env = withOpenCodePermissionEnv({})

    expect(env[OPENCODE_PERMISSION]).toBe(OPENCODE_ALLOW_ALL_PERMISSION_VALUE)
  })

  it('overrides inherited OpenCode permissions unless LoopTroop is explicitly told to inherit', () => {
    const env = withOpenCodePermissionEnv({
      [OPENCODE_PERMISSION]: '{"bash":"ask"}',
    })

    expect(env[OPENCODE_PERMISSION]).toBe(OPENCODE_ALLOW_ALL_PERMISSION_VALUE)
  })

  it('preserves inherited OpenCode permissions when requested', () => {
    const env = withOpenCodePermissionEnv({
      LOOPTROOP_OPENCODE_PERMISSION_MODE: 'inherit',
      [OPENCODE_PERMISSION]: '{"bash":"ask"}',
    })

    expect(env[OPENCODE_PERMISSION]).toBe('{"bash":"ask"}')
  })

  it('falls back to allow-all for unknown modes', () => {
    const env = withOpenCodePermissionEnv({
      LOOPTROOP_OPENCODE_PERMISSION_MODE: 'banana',
      [OPENCODE_PERMISSION]: '{"bash":"ask"}',
    })

    expect(env[OPENCODE_PERMISSION]).toBe(OPENCODE_ALLOW_ALL_PERMISSION_VALUE)
  })
})
