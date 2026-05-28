# Operations Guide

This guide covers the parts of LoopTroop you deal with after the first run: startup maintenance, runtime storage, project-local Git hygiene, worktree cleanup, diagnostics, and common local service issues.

## Quick Reference

| Task | Start here |
| --- | --- |
| Start the full local stack | `npm run dev` |
| Start once without dependency/audit mutation | `LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev` |
| Skip only the local OpenCode CLI upgrade | `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev` |
| Inherit your external OpenCode permission mode | `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit npm run dev` |
| Share the dashboard on a trusted local network | `npm run dev --lan` |
| Print full managed OpenCode DEBUG logs in the terminal | `npm run dev --opencode-logs=all` |
| Force all startup maintenance now | `LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev` |
| Diagnose slow UI or ticket refresh stalls | `npm run diagnose:stall` |
| Clean tracked LoopTroop runtime paths from a project | `git rm --cached -r .looptroop` inside the attached project |

## Runtime Storage

LoopTroop deliberately separates app-level state from project-level runtime state.

| Location | Contents | Notes |
| --- | --- | --- |
| `~/.config/looptroop/app.sqlite` | App settings, profiles, and attached-project registry | Override with `LOOPTROOP_CONFIG_DIR` or `LOOPTROOP_APP_DB_PATH` |
| `<project>/.looptroop/db.sqlite` | Project tickets, phase artifacts, attempts, sessions, status history, and error occurrences | Project-local operational database |
| `<project>/.looptroop/worktrees/<ticket>/` | Ticket-owned Git worktree and `.ticket/**` runtime artifacts | One worktree per ticket |
| `<ticket-worktree>/.ticket/runtime/` | Execution logs, stream state, locks, session records, temporary files, and state projection | Preserved or cleaned according to ticket outcome and cleanup choice |

LoopTroop adds `/.looptroop/` and `/.ticket/` to the repository-local `.git/info/exclude` file when a project is attached. That keeps project-level runtime state and ticket-local artifacts out of normal Git status without modifying the project's committed `.gitignore`.

## Startup Maintenance

`npm run dev` starts the frontend, backend, docs server, and OpenCode watcher stack. Before those services launch, LoopTroop runs a dev preflight that:

- prints immediate progress for bootstrap checks, daily maintenance, stale-process cleanup, and port availability so startup does not appear stalled during slower checks
- verifies required local dev binaries exist, using `npm ci` when dependencies need to be restored
- checks direct dependencies against npm publish metadata
- updates stale direct dependencies only to stable releases that are newer than the current installed version and at least 7 days old
- holds newer releases that are still inside that 7-day delay, and installs the newest eligible older release when one exists
- previews `npm audit fix` lockfile changes and runs the fix only when every proposed npm package version has passed the same 7-day delay
- upgrades the local `opencode` CLI to the latest available version when the binary is installed
- checks and reclaims only stale LoopTroop-owned processes on configured ports
- prints one concise startup summary by default, including a short package gate note, updated package names, previous and new versions, held package names, and next eligible times

`npm run dev` also resolves the local OpenCode server endpoint before the dev services launch:

- **Reuse:** if the configured address is already responding to authenticated requests, `npm run dev` reuses that running instance.
- **Port fallback:** if the default port (`4096`) is occupied by a non-OpenCode process, `npm run dev` scans for the next free port and starts OpenCode there instead.
- **Permission mode:** when `npm run dev` starts the managed OpenCode server, it sets `OPENCODE_PERMISSION='"allow"'` by default so trusted LoopTroop sessions are not blocked by OpenCode approval prompts. Set `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` to leave any existing OpenCode permission environment untouched.
- **LAN sharing:** start with `npm run dev --lan` to expose the frontend and docs servers on a trusted local network. The startup summary prints LAN URLs and a QR code for mobile testing, while backend API and OpenCode ports remain loopback-only behind the Vite dev proxy. When running inside WSL, LoopTroop does not start a relay process; it explains that WSL uses a private `172.x` network behind Windows, then prints one Windows PowerShell Administrator `netsh interface portproxy` plus firewall one-liner for users who want LAN access through the Windows host. The generated WSL command listens on detected Windows LAN addresses, clears stale wildcard `0.0.0.0` forwarding entries, starts the Windows IP Helper service, checks whether the matching Windows network profile is Private, prints an exact `Set-NetConnectionProfile -InterfaceIndex <id> -NetworkCategory Private` fix command when the profile is Public, runs a Windows-side `Test-NetConnection` self-test against the forwarded URLs, and forwards through Windows localhost into WSL so it does not depend on the current WSL NAT address. Use `LOOPTROOP_DEV_HOST=<host-or-ip> npm run dev` when you need to bind a specific non-WSL interface. Router/AP client isolation cannot be reliably detected from the dev machine; if the self-test passes but a phone still cannot load the Windows LAN URL, confirm the phone is on the same non-guest Wi-Fi and client isolation is disabled on the router.
- **Verbose OpenCode logs:** start with `npm run dev --opencode-logs=all` to print full managed OpenCode DEBUG logs in your terminal via `--print-logs --log-level DEBUG`. This only affects servers started by the dev launcher; reused, remote, or mock OpenCode servers keep their own logging configuration. Treat DEBUG output as sensitive local troubleshooting data because it may include request or provider details.
- **Provider error enrichment:** if OpenCode reports only `Provider returned error`, LoopTroop scans the newest local OpenCode logs for the same session and records the exact sanitized provider cause when available. Set `LOOPTROOP_OPENCODE_LOG_DIR` when reusing an external OpenCode server whose logs are not in the default location.
- **Ephemeral auth:** if `OPENCODE_SERVER_PASSWORD` is not set and a new local OpenCode server is about to start, `npm run dev` generates a random credential and sets `OPENCODE_SERVER_USERNAME` to `opencode`. This credential is propagated automatically to all child processes — backend and watcher — for the duration of the session.
- **Ephemeral API token:** if `LOOPTROOP_API_TOKEN` is not set, `npm run dev` generates one for the backend and Vite dev proxy so local same-origin `/api/*` calls are protected without embedding the token in the frontend bundle.

That means `npm run dev` can intentionally mutate local dependency files when aged direct dependency updates or audit fixes are available. The expensive networked maintenance work is daily-gated during normal startup. Direct dependency sync, npm audit remediation, and OpenCode CLI upgrade checks run on the first local dev start of the day. If `package.json` or `package-lock.json` changes later the same day, the affected maintenance step runs again immediately.

The 7-day release delay applies to direct npm package updates selected by dependency sync and to all npm package versions proposed by audit remediation. Audit remediation is all-or-nothing: if npm proposes any package version that is too fresh or whose publish time cannot be verified, LoopTroop holds the entire `npm audit fix` attempt and reports the held package names and next eligible times during normal startup. OpenCode is exempt: the local OpenCode CLI and the direct `@opencode-ai/sdk` package update immediately when their normal maintenance path runs.

## Maintenance Commands

Run the individual maintenance steps directly when you need tighter control:

```bash
npm run deps:sync
npm run audit:remediate
npm run opencode:upgrade
```

Use one-run startup flags when you want to change `npm run dev` behavior:

```bash
LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev
LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev
LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev
npm run dev --lan
npm run dev --opencode-logs=all
```

## Scripts Reference

All scripts are available with `npm run <name>`.

### Development Stack

| Script | Purpose |
| --- | --- |
| `dev` | Full stack: frontend, backend, docs server, OpenCode watcher, and dev preflight. **Standard start command.** |
| `dev:app` | Frontend and backend only — no docs server, no OpenCode watcher. Use when OpenCode is already running externally and docs are not needed locally. |
| `dev:frontend` | Vite dev server only. |
| `dev:backend` | Backend Express server only. |
| `dev:opencode` | OpenCode watcher only. |
| `docs:dev` | VitePress docs server only. |

### Build And Preview

| Script | Purpose |
| --- | --- |
| `build` | Type-check and produce a production frontend bundle (`tsc -b && vite build`). |
| `preview` | Serve the last production build locally for inspection. |
| `docs:build` | Build the static VitePress docs site. |
| `docs:preview` | Serve the last static docs build locally. |

### Tests And Code Quality

| Script | Purpose |
| --- | --- |
| `test` | Run all test projects once and exit. |
| `test:client` | Client tests only (`client-dom` and `client-node` projects). |
| `test:server` | Server tests only (`server-pure` and `server-integration` projects). |
| `test:watch` | Run all tests in watch mode. Useful during active development. |
| `typecheck` | Type-check the full project with `tsc --noEmit`. |
| `lint` | Lint the full project with ESLint. |

`vitest.config.ts` defines four test projects:

- **`client-dom`** — React component tests that require a JSDOM environment
- **`client-node`** — client-side logic tests that do not need a DOM
- **`server-pure`** — server unit tests with no I/O or database
- **`server-integration`** — server integration tests running against a real local SQLite instance

Run `test:client` and `test:server` separately when you only want to validate one layer. Run `test` to validate both together.

### Database Schema Tools

| Script | Purpose |
| --- | --- |
| `db:generate` | Generate app DB migration artifacts for external tooling review. Alias for `db:generate:app`; normal app schema changes still need `server/db/schema.ts` and runtime bootstrap updates in `server/db/init.ts`. |
| `db:generate:app` | Generate app DB migration artifacts from the configured app database target. Verify output against `server/db/schema.ts` before committing. |
| `db:generate:project` | Generate project DB migration artifacts from `LOOPTROOP_PROJECT_DB_PATH`. |
| `db:push` | App DB push command retained for ad-hoc local experiments only; do not use as the normal app schema-change workflow. |
| `db:push:app` | Same as `db:push`; avoid for normal app schema changes because runtime bootstrap owns app DB creation/evolution. |
| `db:push:project` | Push schema changes directly to the project database target from `LOOPTROOP_PROJECT_DB_PATH`. |

The app database is runtime-bootstrapped by `server/db/init.ts`. The committed migration directory is not the source of truth for live app startup. Project DB work should use the explicit project scripts.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port; also drives the default frontend origin when `LOOPTROOP_FRONTEND_ORIGIN` is unset |
| `LOOPTROOP_FRONTEND_ORIGIN` | Override full frontend origin URL, for example `http://my-server:5173`; a valid explicit origin takes precedence over `LOOPTROOP_FRONTEND_PORT`, while an invalid value falls back to the default origin |
| `LOOPTROOP_BACKEND_HOST` | Backend bind host; defaults to `127.0.0.1` |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_ALLOW_REMOTE_API=1` | Required before binding the backend to a non-loopback host; remote binds still require `LOOPTROOP_API_TOKEN` |
| `LOOPTROOP_ALLOW_UNAUTHENTICATED=1` | Permit unauthenticated `/api/*` access only when no `LOOPTROOP_API_TOKEN` is configured; intended for local-only troubleshooting, not remote exposure |
| `LOOPTROOP_API_TOKEN` | Optional token required by `/api/*`; `npm run dev` generates an ephemeral value when unset and the Vite dev proxy forwards it server-side |
| `LOOPTROOP_TRUST_PROXY=1` | Trust `x-forwarded-for` / `x-real-ip` for rate-limit buckets; leave unset unless a trusted proxy owns those headers |
| `LOOPTROOP_ENABLE_DEV_EVENT=1` | Enable the development-only ticket event injection route when paired with `LOOPTROOP_DEV_EVENT_TOKEN` |
| `LOOPTROOP_DEV_EVENT_TOKEN` | Required secret for the dev-event route when it is enabled |
| `LOOPTROOP_DOCS_PORT` | Override docs port |
| `LOOPTROOP_DOCS_ORIGIN` | Override full docs origin URL, for example `http://my-server:5174`; takes precedence over `LOOPTROOP_DOCS_PORT` |
| `LOOPTROOP_DEV_HOST` | Direct watcher fallback for LAN sharing; set to `1`/`0.0.0.0` or a specific host/IP when not launching through `npm run dev --lan` |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `LOOPTROOP_PROJECT_DB_PATH` | Project database target for explicit Drizzle project DB commands |
| `LOOPTROOP_DEV_SKIP_DEPS=1` | Skip automatic dependency sync and audit remediation during `npm run dev` |
| `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1` | Skip the automatic local OpenCode CLI upgrade during `npm run dev` |
| `LOOPTROOP_DEV_FORCE_MAINTENANCE=1` | Bypass the once-per-day maintenance gate and force all startup maintenance checks now |
| `LOOPTROOP_OPENCODE_MODE` | Set to `mock` to use the mock adapter instead of the real SDK adapter |
| `LOOPTROOP_OPENCODE_LOGS=all` | Direct watcher fallback for `npm run dev:opencode`; starts a managed OpenCode server with `--print-logs --log-level DEBUG` when the watcher actually launches OpenCode |
| `LOOPTROOP_OPENCODE_LOG_DIR` | Optional OpenCode log directory used to enrich generic provider errors from an external or nonstandard OpenCode server |
| `CHOKIDAR_USEPOLLING` | Set to `1` to force chokidar polling for file watching; auto-set on mounted WSL drives, but can be overridden manually |
| `OPENCODE_SERVER_USERNAME` | Basic auth username for the local OpenCode dev server; defaults to `opencode` when `OPENCODE_SERVER_PASSWORD` is also set |
| `OPENCODE_SERVER_PASSWORD` | Basic auth password for the local OpenCode dev server; auto-generated as an ephemeral random credential by `npm run dev` if not set and a new local OpenCode server is about to start |

Default local service addresses:

| Service | Address |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend | `http://127.0.0.1:3000` |
| Docs | `http://localhost:5174` |
| OpenCode | `http://127.0.0.1:4096` |

When `LOOPTROOP_FRONTEND_ORIGIN` is not explicitly set, LoopTroop derives the frontend origin from `LOOPTROOP_FRONTEND_PORT`, defaulting to `http://localhost:5173`. If `LOOPTROOP_FRONTEND_ORIGIN` is set but cannot be parsed as a URL origin, LoopTroop ignores it and falls back to that derived default.

## API Rate Limits

The backend applies a global per-client rate limit to `/api/*` routes. Read requests, normal write actions, and UI-state autosaves use separate buckets so frequent draft saves do not exhaust the workflow-action budget. Defaults are 200 reads/minute, 120 normal writes/minute, and 300 autosaves/minute per client. If a client exceeds a limit, the API returns `429` with a `Retry-After` response header in seconds. Wait for that interval before retrying requests or refreshing aggressively.

Forwarded client IP headers are ignored unless `LOOPTROOP_TRUST_PROXY=1` is set. This keeps local clients from bypassing limits by spoofing `x-forwarded-for`.

## Project Git Hygiene

If `.looptroop` was already tracked before the project was attached, ticket startup is blocked with `INIT_LOOPTROOP_TRACKED`. This prevents nested or stale LoopTroop worktree data from being checked out into every new ticket worktree.

Clean that repository from the attached project root:

```bash
git rm --cached -r .looptroop
git commit -m "Stop tracking LoopTroop runtime data"
```

This removes LoopTroop runtime paths from the Git index without deleting the local runtime files from disk.

After cleanup, `git status --short .looptroop` should not show tracked `.looptroop` entries. Runtime files may still exist locally, but they should be ignored by the repo-local exclude. Ticket worktree artifacts under `.ticket/**` are also ignored locally and excluded from future bead commits; they remain available to LoopTroop but are not intended for target repository branches.

Other ticket initialization errors from the Git hygiene check:

- `INIT_LOOPTROOP_EXCLUDE_FAILED` — LoopTroop could not write the `.looptroop/` exclusion to `.git/info/exclude`. Check that the project's `.git` directory is writable.
- `INIT_LOOPTROOP_TRACKED_CHECK_FAILED` — The `git ls-files` check itself failed. Verify that the attached project path is a valid, accessible Git repository.

## Worktree Disk Cleanup

Over time `.looptroop/worktrees/` can grow large as completed and canceled tickets leave behind code checkouts, execution logs, and generated file artifacts.

Use the UI cleanup flow:

1. Open **Settings -> Projects** and click **Edit** on the project you want to clean up.
2. Click **Free Disk Space...** at the bottom-left, next to **Delete Project**.
3. Click **Calculate Size** to see how much space can be freed.
4. Click **Delete Worktrees** to remove worktrees for completed and canceled tickets.

**Deleted:** temporary directories at `.looptroop/worktrees/<ticket>/` for tickets in the Completed or Canceled column, including code checkouts, execution logs, and AI-generated file artifacts.

**Preserved:**

- project source code and normal repository files
- active, queued, and draft ticket worktrees
- ticket records in the dashboard, including title, description, and status

## Diagnostics

If the UI feels slow, tickets disappear after refresh, or the app appears to stall, run the diagnostic command while `npm run dev` is still running:

```bash
npm run diagnose:stall
```

The report is saved under `tmp/diagnostics/` and includes endpoint latency, backend/frontend/OpenCode activity, trend-wide whole-system CPU/RSS/I/O consumers, pressure-stall metrics, SQLite/WAL state, attached project health, active sessions, Git responsiveness, and optional focused ticket runtime artifact sizing.

Useful options:

```bash
npm run diagnose:stall -- --sample-ms 5000
npm run diagnose:stall -- --timeout-ms 8000
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
npm run diagnose:stall -- --ticket-path /path/to/worktree/.ticket
```

For the full report guide, see [Runtime Diagnostics](diagnostics.md).

## OpenCode Reachability

Symptoms:

- the model list in the UI is empty
- ticket logs show connection errors
- phases that need a model block before drafting, setup, or execution

Checks:

When using `npm run dev`, port resolution and basic auth are handled automatically. The checks below apply when OpenCode is still unreachable after startup or when running the backend outside of `npm run dev`.

1. Ensure OpenCode is running: `opencode serve`.
2. Ping the backend health endpoint: `curl http://127.0.0.1:3000/api/health/opencode`. If you configured `LOOPTROOP_API_TOKEN`, include `-H "X-LoopTroop-Token: $LOOPTROOP_API_TOKEN"`.
3. If OpenCode is on a non-default port, set `LOOPTROOP_OPENCODE_BASE_URL`, for example `export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4097`.
4. If you started OpenCode outside of `npm run dev`, ensure `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` match the values LoopTroop is using. A credential mismatch causes silently failed requests.

## Watcher and Filesystem Notes

The backend watcher prefers native file watching on normal local filesystems. Under WSL, mounted-drive workspaces such as `/mnt/...` can be slower and may need polling. LoopTroop auto-enables chokidar polling for those mounted-drive workspaces.

If your environment still misses file changes, force polling for the run:

```bash
CHOKIDAR_USEPOLLING=1 npm run dev
```

## Audit Warnings

`npm audit --omit=dev` should be clean. A full `npm audit` can still report dev-only moderate findings through transitive dev-server tooling:

- `drizzle-kit` stable still depends on deprecated `@esbuild-kit/*`, which brings an older `esbuild`. The upstream issue is tracked here: [drizzle-team/drizzle-orm#3067](https://github.com/drizzle-team/drizzle-orm/issues/3067).
- `vitepress` stable still brings its own older Vite/esbuild line. The current audit path reports the esbuild development-server advisory [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

Do not run `npm audit fix --force` as routine maintenance for these warnings. The current forced fix path proposes a breaking `drizzle-kit` downgrade and does not represent a safe application hardening change.

## Related Docs

- [Getting Started](getting-started.md)
- [System Architecture](system-architecture.md)
- [Runtime Diagnostics](diagnostics.md)
- [OpenCode Integration](opencode-integration.md)
