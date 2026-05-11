import { defineConfig } from 'drizzle-kit'

const projectDbPath = process.env.LOOPTROOP_PROJECT_DB_PATH?.trim() || '.looptroop/db.sqlite'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: projectDbPath,
  },
})
