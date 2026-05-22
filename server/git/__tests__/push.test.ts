import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSyncMock = vi.fn()

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  }
})

function makeSpawnResult(overrides: {
  status?: number
  stdout?: string
  stderr?: string
  error?: Error
} = {}): ReturnType<typeof import('node:child_process').spawnSync> {
  return {
    status: overrides.status ?? 0,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    error: overrides.error,
    pid: 123,
    output: [null, overrides.stdout ?? '', overrides.stderr ?? ''],
    signal: null,
  } as ReturnType<typeof import('node:child_process').spawnSync>
}

describe('server/git/push', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnSyncMock.mockReset()
  })

  it('pushes branch refs without forcing progress output', async () => {
    spawnSyncMock.mockReturnValue(makeSpawnResult())

    const { pushBranchRef } = await import('../push')
    const result = pushBranchRef({
      projectPath: '/repo',
      destinationBranch: 'TEST-1',
      sourceRef: 'HEAD',
      maxRetries: 1,
    })

    expect(result).toEqual({ pushed: true })
    expect(spawnSyncMock).toHaveBeenCalledWith('git', [
      '-C',
      '/repo',
      'push',
      'origin',
      'HEAD:refs/heads/TEST-1',
    ], expect.objectContaining({ encoding: 'utf8' }))
    expect(spawnSyncMock.mock.calls[0]?.[1]).not.toContain('--progress')
  })
})
