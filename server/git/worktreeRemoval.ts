import { existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { makeOwnerWritableRecursive } from '../io/removal'

type GitCommandRunner = (args: string[]) => void

export interface RemoveWorktreeOptions {
  projectRoot: string
  worktreesRoot: string
  worktreePath: string
  runGit?: GitCommandRunner
}

function runGitCommand(projectRoot: string, args: string[]): void {
  const result = spawnSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' })
  if (result.status === 0 && !result.error) return

  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  const detail = result.error?.message
    ?? ([stdout, stderr].filter(Boolean).join(' | ')
      || `exit code ${result.status ?? '?'}`)
  throw new Error(detail)
}

/**
 * Removes a LoopTroop-managed Git worktree even when project tooling created
 * read-only files or directories inside it. Symlinks are never followed.
 */
export function removeWorktree({
  projectRoot,
  worktreesRoot,
  worktreePath,
  runGit = (args) => runGitCommand(projectRoot, args),
}: RemoveWorktreeOptions): void {
  const resolvedWorktreesRoot = resolve(worktreesRoot)
  const resolvedWorktreePath = resolve(worktreePath)
  if (dirname(resolvedWorktreePath) !== resolvedWorktreesRoot) {
    throw new Error(`Refusing to remove path outside the managed worktrees root: ${resolvedWorktreePath}`)
  }

  if (!existsSync(worktreePath)) return

  makeOwnerWritableRecursive(worktreePath)

  let gitRemovalFailed = false
  try {
    runGit(['worktree', 'remove', '--force', worktreePath])
  } catch {
    gitRemovalFailed = true
  }

  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true })
  }

  if (gitRemovalFailed) {
    try {
      runGit(['worktree', 'prune'])
    } catch {
      // The filesystem target is already removed; stale Git metadata can be
      // pruned by a later cleanup operation.
    }
  }
}
