import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorktreeGitHookPolicy, shouldBypassGitHooks } from '../hookPolicy'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Git hook policy', () => {
  it.each([
    ['validate_explicitly', true],
    ['use_on_internal_commits', false],
    ['ignore_internal_only', true],
  ] as const)('resolves %s and chooses internal bypass=%s', (policy, bypass) => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-policy-'))
    roots.push(root)
    mkdirSync(join(root, '.ticket/runtime'), { recursive: true })
    writeFileSync(join(root, '.ticket/runtime/execution-setup-profile.json'), JSON.stringify({
      git_hooks: { policy },
    }))

    const resolved = readWorktreeGitHookPolicy(root)
    expect(resolved).toBe(policy)
    expect(shouldBypassGitHooks(resolved)).toBe(bypass)
  })

  it('uses explicit validation as the safe default when no profile exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-policy-'))
    roots.push(root)
    expect(readWorktreeGitHookPolicy(root)).toBe('validate_explicitly')
  })
})
