type EnvLike = Record<string, string | undefined>

export interface OpenCodeBasicAuthConfig {
  username: string
  password: string
}

export function getOpenCodeBasicAuthConfig(env: EnvLike = process.env): OpenCodeBasicAuthConfig | null {
  const password = env.OPENCODE_SERVER_PASSWORD?.trim()
  if (!password) return null

  return {
    username: env.OPENCODE_SERVER_USERNAME?.trim() || 'opencode',
    password,
  }
}

export function getOpenCodeBasicAuthHeader(env: EnvLike = process.env): string | undefined {
  const auth = getOpenCodeBasicAuthConfig(env)
  if (!auth) return undefined
  if (auth.username.includes(':')) {
    console.warn('[opencodeAuth] Basic auth username contains ":" — this will produce an invalid Authorization header. Please use a username without colons.')
    return undefined
  }
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
}
