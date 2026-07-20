import type { GitHookPolicy } from '@/lib/executionSetupPlan'

export type GitHookPolicyOverride = GitHookPolicy | null
export type GitHookPolicySource = 'ticket' | 'project' | 'profile'

export function resolveGitHookPolicySetting(
  ticketOverride: GitHookPolicyOverride,
  projectOverride: GitHookPolicyOverride,
  profilePolicy: GitHookPolicy,
): { policy: GitHookPolicy; source: GitHookPolicySource } {
  if (ticketOverride !== null) return { policy: ticketOverride, source: 'ticket' }
  if (projectOverride !== null) return { policy: projectOverride, source: 'project' }
  return { policy: profilePolicy, source: 'profile' }
}
