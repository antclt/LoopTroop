import { describe, expect, it } from 'vitest'
import { LOOPTROOP_OPENCODE_LOGS, NPM_CONFIG_OPENCODE_LOGS, resolveOpenCodeLogMode } from '../scripts/opencode-log-mode'

describe('resolveOpenCodeLogMode', () => {
  it('uses WARN-only OpenCode serve args by default', () => {
    expect(resolveOpenCodeLogMode({ env: {} })).toEqual({
      mode: 'default',
      requested: false,
      serveArgs: ['--log-level', 'WARN'],
    })
  })

  it('supports npm run config flags without the argument forwarding separator', () => {
    expect(resolveOpenCodeLogMode({
      env: { [NPM_CONFIG_OPENCODE_LOGS]: 'all' },
    })).toEqual({
      mode: 'all',
      requested: true,
      serveArgs: ['--print-logs', '--log-level', 'DEBUG'],
      source: 'npm-config',
    })
  })

  it('supports an environment fallback for direct OpenCode watcher use', () => {
    expect(resolveOpenCodeLogMode({
      env: { [LOOPTROOP_OPENCODE_LOGS]: 'all' },
    })).toEqual({
      mode: 'all',
      requested: true,
      serveArgs: ['--print-logs', '--log-level', 'DEBUG'],
      source: 'env',
    })
  })

  it('rejects invalid requested log modes with a clear message', () => {
    expect(() => resolveOpenCodeLogMode({
      env: { [NPM_CONFIG_OPENCODE_LOGS]: 'debug' },
    })).toThrow('Invalid OpenCode log mode "debug". Use npm run dev --opencode-logs=all.')

    expect(() => resolveOpenCodeLogMode({
      env: { [LOOPTROOP_OPENCODE_LOGS]: 'verbose' },
    })).toThrow('Invalid OpenCode log mode "verbose". Use LOOPTROOP_OPENCODE_LOGS=all.')
  })
})
