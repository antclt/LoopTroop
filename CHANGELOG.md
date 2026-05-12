# Changelog

All notable changes to LoopTroop will be documented in this file.

## [Unreleased]

### Security & Reliability
- Fixed timing side-channel in API token comparison: `constantTimeEquals` now always runs `timingSafeEqual` even when token lengths differ, preventing length-leak via response timing.
- SSE authentication: `apiToken` query parameter now accepted exclusively on `/api/stream` (the only endpoint where browser `EventSource` clients cannot set custom headers); all other endpoints reject query-param tokens.
- Added startup warning when both `LOOPTROOP_ALLOW_UNAUTHENTICATED=1` and `LOOPTROOP_ALLOW_REMOTE_API=1` are set simultaneously.
- Request body size limit now enforced for chunked requests without a `Content-Length` header, preventing memory exhaustion via large unbounded bodies.
- `validateJson` middleware now validates JSON syntax early and returns 400 rather than allowing handlers to surface unhandled 500 errors.
- Fixed permanent memory leak in SSE stream handler: `await new Promise(() => {})` replaced with a resolvable promise; stream now cleanly resolves on client disconnect.
- Fixed race condition in SSE double-cleanup: added `cleanedUp` guard to prevent `broadcaster.removeClient` from running twice on concurrent abort and error.
- Project SQLite database cache now evicts the oldest entry when it exceeds 50 entries, preventing unbounded memory and file-descriptor growth.
- `startingTickets` set now cleaned up in a `finally` block, preventing permanent blocking of ticket starts after unexpected errors.
- `isLoopbackHost` and `isLocalhostRequest` now recognise IPv4-mapped IPv6 loopback addresses (`::ffff:127.0.0.1`, `::ffff:7f00:1`).
- Basic auth header builder now validates that the username does not contain `:` (RFC 7617 compliance).

### Performance
- `contextCache` in `contextBuilder.ts` now evicts stale entries on cache misses, preventing unbounded accumulation in long-running processes.
- `persistedFingerprintsByTicket` map capped at 100 entries to prevent unbounded memory growth.
- Pre-compiled credential-redaction regex in `errorDiagnostics.ts` (was re-created on every call).
- `errorDiagnostics` `modelId` and similar fields now computed once and reused instead of double-sanitising.

### Bug Fixes
- `isRecord` type guard now correctly excludes `Date`, `Map`, and `Set` instances.
- `parsePort` uses `parseInt(value, 10)` with `Number.isNaN` check to reject strings like `"300e0"`.
- `isBeforeExecution` in `workflowMeta.ts` now has a recursion depth guard to prevent stack overflow on cyclic workflow states.
- `useSSE` stale-closure bug fixed: `ticketIdRef` used inside `onerror`/`onopen` handlers instead of the captured closure variable.
- `AIQuestionContext` polling interval no longer restarts on every render; `activeTicketKey` is now computed inside a stable `useMemo`.
- `readYamlArray` JSON Lines fallback now falls through to YAML parsing on parse failure instead of returning `null`.
- App SQLite database now uses lazy initialization via Proxy, preventing DB file creation at module import time.
- `drizzle.project.config.ts` default DB path now resolved relative to the config file instead of the current working directory.
- `DraftView` state sync moved into `useEffect` to prevent React anti-pattern of setting state during render.
- `DropdownPicker` now repositions on window resize and scroll while open.
- `KeyboardShortcuts` `?` shortcut now suppressed on `contentEditable` elements and `<select>` in addition to `<input>`/`<textarea>`.
- `dev-preflight.mjs` deduplicated: now delegates to `tsx scripts/dev-preflight.ts` instead of duplicating utility functions.
- `logUtils.ts` localStorage log entries now pruned to `MAX_LOG_ENTRIES_PER_PHASE` to prevent quota exhaustion.

### Configuration
- `vitest.config.ts`: all test projects now use `isolate: true` to prevent test state leakage.
- `tsconfig.json`: `scripts/` directory added to `include` so dev scripts are fully type-checked.

## [0.1.0] - 2026-04-27

- Clarified the README around local AI coding orchestration for repo-scale work, LLM Council planning, Ralph-loop recovery, OpenCode worktrees, and human-in-the-loop PR automation.
- Added repository trust files for licensing, security reporting, contribution flow, conduct expectations, citation metadata, issue templates, and pull request review.
- Added a GitHub social preview asset for shared repository links.
