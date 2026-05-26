import { describe, expect, it } from 'vitest'
import {
  OPENCODE_ALLOW_ALL_PERMISSION_VALUE,
  OPENCODE_ENABLE_EXA,
  OPENCODE_PERMISSION,
  withManagedOpenCodeServerEnv,
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

  it('enables OpenCode websearch support for the managed server by default', () => {
    const env = withManagedOpenCodeServerEnv({})

    expect(env[OPENCODE_ENABLE_EXA]).toBe('1')
  })

  it('forces OpenCode websearch support on for the managed server', () => {
    const env = withManagedOpenCodeServerEnv({
      [OPENCODE_ENABLE_EXA]: '0',
    })

    expect(env[OPENCODE_ENABLE_EXA]).toBe('1')
  })
})
