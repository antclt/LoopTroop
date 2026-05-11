const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const GITHUB_OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i
const GITHUB_REPO_PATTERN = /^[a-z\d._-]+$/i

export function getSafeGitHubPullRequestUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null
  if (url.username || url.password) return null

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 4) return null

  const [owner, repo, pullKeyword, pullNumber] = segments
  if (!owner || !repo || pullKeyword !== 'pull') return null
  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPO_PATTERN.test(repo)) return null
  if (!/^\d+$/.test(pullNumber ?? '')) return null

  return url.href
}
