import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runExplicitGitHookValidation } from '../hookValidation'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function profile(policy: string, command = ''): string {
  return JSON.stringify({
    git_hooks: {
      policy,
      validation_commands: command ? [{ id: 'pre-commit', hook: 'pre-commit', command, purpose: 'test' }] : [],
    },
  })
}

describe('runExplicitGitHookValidation', () => {
  it('runs approved commands and persists a passing receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-validation-'))
    roots.push(root)
    const result = await runExplicitGitHookValidation({
      profileContent: profile('validate_explicitly', 'node -e "process.exit(0)"'),
      worktreePath: root,
    })
    expect(result.errors).toEqual([])
    expect(result.receipts).toEqual([expect.objectContaining({ id: 'pre-commit', status: 'passed', exitCode: 0 })])
  })

  it('returns the first explicit validation failure with output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-validation-'))
    roots.push(root)
    const result = await runExplicitGitHookValidation({
      profileContent: profile('validate_explicitly', 'node -e "process.stderr.write(\'missing prerequisite\'); process.exit(4)"'),
      worktreePath: root,
    })
    expect(result.receipts[0]).toMatchObject({ status: 'failed', exitCode: 4, outputExcerpt: 'missing prerequisite' })
    expect(result.errors[0]).toContain('missing prerequisite')
  })

  it.each(['use_on_internal_commits', 'ignore_internal_only'] as const)('does not run explicit commands for %s', async (policy) => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-validation-'))
    roots.push(root)
    const result = await runExplicitGitHookValidation({
      profileContent: profile(policy, 'node -e "process.exit(9)"'),
      worktreePath: root,
    })
    expect(result).toMatchObject({
      policy,
      errors: [],
      receipts: [expect.objectContaining({ status: 'skipped' })],
      fileAudit: { mutated: false, candidatePaths: [], temporaryPaths: [], internalPaths: [] },
    })
  })

  it('audits files mutated by an explicit hook command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'looptroop-hook-validation-'))
    roots.push(root)
    const { execFileSync } = await import('node:child_process')
    const { writeFileSync } = await import('node:fs')
    execFileSync('git', ['init', root], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'])
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    execFileSync('git', ['-C', root, 'add', 'tracked.txt'])
    execFileSync('git', ['-C', root, 'commit', '-m', 'initial'], { stdio: 'ignore' })

    const result = await runExplicitGitHookValidation({
      profileContent: profile('validate_explicitly', 'node -e "require(\'fs\').writeFileSync(\'tracked.txt\', \'after\\n\')"'),
      worktreePath: root,
    })
    expect(result.fileAudit).toMatchObject({ mutated: true, candidatePaths: ['tracked.txt'] })
  })
})
