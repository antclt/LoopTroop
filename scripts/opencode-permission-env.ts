export const LOOPTROOP_OPENCODE_PERMISSION_MODE = 'LOOPTROOP_OPENCODE_PERMISSION_MODE'
export const OPENCODE_PERMISSION = 'OPENCODE_PERMISSION'
export const OPENCODE_ALLOW_ALL_PERMISSION_VALUE = '"allow"'
export const OPENCODE_ENABLE_EXA = 'OPENCODE_ENABLE_EXA'

export type LoopTroopOpenCodePermissionMode = 'allow' | 'inherit'

export function resolveOpenCodePermissionMode(env: NodeJS.ProcessEnv): LoopTroopOpenCodePermissionMode {
  const raw = env[LOOPTROOP_OPENCODE_PERMISSION_MODE]?.trim().toLowerCase()
  return raw === 'inherit' ? 'inherit' : 'allow'
}

export function withOpenCodePermissionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (resolveOpenCodePermissionMode(env) === 'inherit') {
    return { ...env }
  }

  return {
    ...env,
    [OPENCODE_PERMISSION]: OPENCODE_ALLOW_ALL_PERMISSION_VALUE,
  }
}

export function withManagedOpenCodeServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = withOpenCodePermissionEnv(env)
  return {
    ...next,
    [OPENCODE_ENABLE_EXA]: '1',
  }
}
