export const LOOPTROOP_OPENCODE_LOGS = 'LOOPTROOP_OPENCODE_LOGS'

export type OpenCodeLogMode = 'default' | 'all'
export type OpenCodeLogModeSource = 'flag' | 'env'

export type ResolvedOpenCodeLogMode = {
  mode: OpenCodeLogMode
  requested: boolean
  serveArgs: string[]
  source?: OpenCodeLogModeSource
}

type ResolveOpenCodeLogModeOptions = {
  argv?: readonly string[]
  env?: Partial<Record<string, string | undefined>>
}

const OPENCODE_LOGS_FLAG = '--opencode-logs'
const ALL_LOGS_VALUE = 'all'

function normalizeLogModeValue(value: string) {
  return value.trim().toLowerCase()
}

function getFlagValue(argv: readonly string[]) {
  let value: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (arg === OPENCODE_LOGS_FLAG) {
      const next = argv[index + 1]
      value = next && !next.startsWith('--') ? next : ''
      index += 1
      continue
    }

    if (arg.startsWith(`${OPENCODE_LOGS_FLAG}=`)) {
      value = arg.slice(`${OPENCODE_LOGS_FLAG}=`.length)
      continue
    }

    if (arg.startsWith(OPENCODE_LOGS_FLAG)) {
      value = arg.slice(OPENCODE_LOGS_FLAG.length)
    }
  }

  return value
}

function assertAllLogsValue(value: string, source: OpenCodeLogModeSource) {
  const normalized = normalizeLogModeValue(value)
  if (normalized === ALL_LOGS_VALUE) {
    return normalized
  }

  const sourceHint = source === 'flag'
    ? `${OPENCODE_LOGS_FLAG}=all`
    : `${LOOPTROOP_OPENCODE_LOGS}=all`
  throw new Error(`Invalid OpenCode log mode "${value}". Use ${sourceHint}.`)
}

export function resolveOpenCodeLogMode({
  argv = process.argv.slice(2),
  env = process.env,
}: ResolveOpenCodeLogModeOptions = {}): ResolvedOpenCodeLogMode {
  const flagValue = getFlagValue(argv)

  if (flagValue !== undefined) {
    assertAllLogsValue(flagValue, 'flag')
    return {
      mode: 'all',
      requested: true,
      serveArgs: ['--print-logs', '--log-level', 'DEBUG'],
      source: 'flag',
    }
  }

  const envValue = env[LOOPTROOP_OPENCODE_LOGS]?.trim()
  if (envValue) {
    assertAllLogsValue(envValue, 'env')
    return {
      mode: 'all',
      requested: true,
      serveArgs: ['--print-logs', '--log-level', 'DEBUG'],
      source: 'env',
    }
  }

  return {
    mode: 'default',
    requested: false,
    serveArgs: ['--log-level', 'WARN'],
  }
}
