import { describe, expect, it } from 'vitest'
import { LOOPTROOP_OPENCODE_LOGS, resolveOpenCodeLogMode } from '../scripts/opencode-log-mode'

describe('resolveOpenCodeLogMode', () => {
  it('uses WARN-only OpenCode serve args by default', () => {
    expect(resolveOpenCodeLogMode({ argv: [], env: {} })).toEqual({
      mode: 'default',
      requested: false,
      serveArgs: ['--log-level', 'WARN'],
    })
  })

  it('maps the npm all-logs flag to DEBUG logs printed to stderr', () => {
    expect(resolveOpenCodeLogMode({ argv: ['--opencode-logs=all'], env: {} })).toEqual({
      mode: 'all',
      requested: true,
      serveArgs: ['--print-logs', '--log-level', 'DEBUG'],
      source: 'flag',
    })
  })

  it('supports an environment fallback for direct OpenCode watcher use', () => {
    expect(resolveOpenCodeLogMode({
      argv: [],
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
      argv: ['--opencode-logs=debug'],
      env: {},
    })).toThrow('Invalid OpenCode log mode "debug". Use --opencode-logs=all.')

    expect(() => resolveOpenCodeLogMode({
      argv: [],
      env: { [LOOPTROOP_OPENCODE_LOGS]: 'verbose' },
    })).toThrow('Invalid OpenCode log mode "verbose". Use LOOPTROOP_OPENCODE_LOGS=all.')
  })
})
