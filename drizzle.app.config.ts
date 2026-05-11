import { defineConfig } from 'drizzle-kit'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

function resolveAppDbPath(): string {
  const configuredDbPath = process.env.LOOPTROOP_APP_DB_PATH?.trim()
  if (configuredDbPath) {
    return isAbsolute(configuredDbPath) ? configuredDbPath : resolve(process.cwd(), configuredDbPath)
  }

  const configuredConfigDir = process.env.LOOPTROOP_CONFIG_DIR?.trim()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
  const configDir = configuredConfigDir
    ? (isAbsolute(configuredConfigDir) ? configuredConfigDir : resolve(process.cwd(), configuredConfigDir))
    : resolve(xdgConfigHome || resolve(homedir(), '.config'), 'looptroop')

  return resolve(configDir, 'app.sqlite')
}

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: resolveAppDbPath(),
  },
})
