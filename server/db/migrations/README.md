# Database Migrations

> **⚠️ Important:** The LoopTroop app database schema is bootstrapped at runtime by `server/db/init.ts`. The committed migration files in this directory may be outdated and do **not** reflect the current canonical schema defined in `server/db/schema.ts`.

## Do not run `drizzle-kit push` or `drizzle-kit migrate` against the app database

These commands target the migration folder and will apply a stale schema that is missing tables, columns, and foreign-key constraints. This will break the application.

## Correct workflow

- Schema changes should be made in `server/db/schema.ts`.
- The app database is created and updated automatically at server startup via `server/db/init.ts`.
- If you need to regenerate migrations for external tooling, use:
  ```bash
  npm run db:generate:app
  ```
  But verify the output against `schema.ts` before committing.
