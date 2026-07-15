import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GitHookPolicy } from '../structuredOutput/types'

export const DEFAULT_GIT_HOOK_POLICY: GitHookPolicy = 'validate_explicitly'

export function isGitHookPolicy(value: unknown): value is GitHookPolicy {
  return value === 'validate_explicitly'
    || value === 'use_on_internal_commits'
    || value === 'ignore_internal_only'
}

export function readWorktreeGitHookPolicy(worktreePath: string): GitHookPolicy {
  try {
    const parsed = JSON.parse(readFileSync(
      resolve(worktreePath, '.ticket/runtime/execution-setup-profile.json'),
      'utf8',
    )) as { git_hooks?: { policy?: unknown }; gitHooks?: { policy?: unknown } }
    const value = parsed.git_hooks?.policy ?? parsed.gitHooks?.policy
    return isGitHookPolicy(value) ? value : DEFAULT_GIT_HOOK_POLICY
  } catch {
    return DEFAULT_GIT_HOOK_POLICY
  }
}

export function shouldBypassGitHooks(policy: GitHookPolicy): boolean {
  return policy !== 'use_on_internal_commits'
}
