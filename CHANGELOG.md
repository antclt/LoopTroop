# Changelog

All notable changes to LoopTroop will be documented in this file.

## [Unreleased]

### Summary
- Added a profile-level Structured Output Retries setting that is locked per ticket and now covers PR draft parsing before GitHub side effects.
- Standardized automatic retry inspection in Raw tabs and manual retry review through archived phase versions.
- Kept structured retry audit controls clearer by making model labels passive, labeling validated retry outputs with their attempt number, and limiting intervention warnings to the primary artifact tab.
- Removed duplicate Raw selector tabs so identical payloads appear once, preferring per-attempt retry tabs over generic raw-output shortcuts.
- Kept single-model Raw views focused by omitting the aggregate selector when only one model source has raw output.
- Raised the OpenCode event-listener warning threshold to reduce noisy stream warnings during parallel ticket activity.
- Made `npm run dev` startup maintenance output include package names, version changes, and held-release eligibility times by default.
- Added a global reconnecting banner that appears on all views when the backend is unreachable, polling every 3 seconds.
- Fixed error navigation from Full Log so selecting an error opens its review view.
- Improved blocked-error diagnostics so OpenCode usage-limit failures remain visible when structured coverage output is empty.
- Made blocked-error diagnostics explain when AI output was cut off by an OpenCode/model length stop, including finish reason and token counts.
- Added a Continue recovery action for eligible blocked OpenCode sessions so temporary model interruptions can resume without starting a fresh phase attempt.

### Detailed Changes

### Added
- Added configurable structured-output retry counts with profile/API/UI validation, ticket-start locking, and documented continued-session versus fresh-session retry classes.
- Added structured retry for pull request title/body drafting before branch push or PR create/update, with diagnostics and deterministic fallback text when parsing remains invalid.
- Added raw attempt persistence for PRD/interview/beads refinement, relevant-files scan, coverage audit/revision, execution setup plan/runtime generation, and final-test generation.
- Added Raw tab variants for structured artifacts with `rawAttempts`, including diagnostic entries when a retry failed before model text existed.
- Added a global backend reconnecting banner in the app header that polls `/api/health` every 3 seconds and shows an amber "Reconnecting to server…" badge whenever the backend is unreachable, covering all views including the Kanban board.
- Added a conditional `Continue` action for `BLOCKED_ERROR` tickets with resumable OpenCode/provider diagnostics and a matching active preserved session; it dispatches `CONTINUE` and sends exactly `continue please` to the same OpenCode session.

### Changed
- Replaced hardcoded one-shot structured retries across scanning, interview/PROM4 parsing, PRD/beads planning, coverage repair, execution setup, coding marker repair, and final-test generation with the locked ticket retry count while keeping broader workflow attempt budgets separate.
- Documented the four retry classes and standardized status/details wording around **continued session**, **fresh session**, and broader **new attempt** loops.
- Manual Retry from `BLOCKED_ERROR` now archives the failed tracked phase attempt and creates a fresh active attempt before rerunning, so rerun artifacts and logs are versioned separately.
- Blocked-error history now records `CONTINUED` resolutions separately from `RETRIED`, and CODING continuation preserves the interrupted bead/session instead of running the normal reset-first retry recovery.
- Canonical artifact flow keeps rejected malformed model output diagnostic-only while downstream phases continue to consume accepted normalized content.
- Structured artifact viewers now keep parser/retry intervention notices on the primary artifact tab, while retry producers share one raw-attempt helper so accepted/rejected attempt metadata stays consistent across phases.
- Made grouped Raw selector model labels passive metadata, labeled validated retry outputs with their accepted attempt number, and deduplicated identical Raw variants, with per-attempt retry/validated tabs preferred over generic `Raw Output`, `Model Output`, `Accepted Output`, `Validated`, or `Rejected` shortcuts.
- Added a project-level OpenCode plugin that sets the Node/Bun event listener warning threshold to 20 inside the OpenCode process.
- Development maintenance output now renders a single default startup summary with package-level dependency update details, held direct dependency details, and held audit remediation eligibility times.
- Removed the separate verbose dev-startup mode so dependency maintenance details appear in normal `npm run dev` output.
- The `npm run dev` startup summary now prints the docs URL once instead of repeating its port as a suffix.

### Fixed
- ApprovalView tests now mock the async UI-state save mutation used by debounced approval draft persistence, preventing timer-driven false failures during full-suite runs.
- Selecting an error from the navigator while Full Log is open now exits full-log mode and opens the error review.
- Blocked coverage errors now preserve underlying OpenCode retry/provider diagnostics, such as usage limits, and avoid repeating an identical parser-wrapper message in the error details.
- Structured-output failures caused by OpenCode `finish_reason=length` are now classified as output truncation and shown in the blocked-error underlying details instead of only surfacing secondary parser messages like missing fields.
- Single-model Raw artifact views no longer show a redundant aggregate selector; raw, validated, and retry variants remain available under the model source.

## [0.2.0] - 2026-05-12

### Added
- Added expanded runtime diagnostics, output-normalization documentation, operations guidance, configuration reference material, and refreshed onboarding docs.
- Added richer ticket/workspace surfaces for setup-plan review, regenerated approval versions, raw/rejected artifact inspection, live phase logs, GitHub links, and completed-ticket worktree cleanup.
- Added broader test coverage across middleware, routes, workflow phases, logs, structured output repair, UI components, dev maintenance, and diagnostics.

### Changed
- Refined the planning flow around interview/PRD approval edits, member-specific council artifacts, winner-model context, coverage warnings, and beads planning.
- Improved dashboard and workspace ergonomics with tighter status chrome, clearer phase summaries, better artifact rendering, keyboard/menu fixes, and more resilient ticket normalization.
- Updated development maintenance behavior so dependency sync, npm audit remediation, and OpenCode maintenance are coordinated through the startup preflight.

### Security & Reliability
- `npm run dev` now restores daily startup dependency/audit/OpenCode maintenance while gating npm dependency updates to releases that are at least 7 days old; if `latest` is too fresh, dependency sync installs the newest eligible older version instead, and audit remediation holds the whole fix when any proposed package version is too fresh. OpenCode CLI and `@opencode-ai/sdk` updates remain immediate.
- Fixed timing side-channel in API token comparison: `constantTimeEquals` now always runs `timingSafeEqual` even when token lengths differ, preventing length-leak via response timing.
- SSE authentication: `apiToken` query parameter now accepted exclusively on `/api/stream` (the only endpoint where browser `EventSource` clients cannot set custom headers); all other endpoints reject query-param tokens.
- Vite dev proxy now injects the ephemeral `LOOPTROOP_API_TOKEN` server-side for same-origin `/api` requests, keeping the token out of the frontend bundle while preserving protected local development.
- `LOOPTROOP_ALLOW_UNAUTHENTICATED=1` only bypasses auth when no API token is configured; non-loopback binds still require `LOOPTROOP_API_TOKEN`.
- Request body size limit now enforced while reading chunked requests without a `Content-Length` header, preventing memory exhaustion via large unbounded bodies.
- `validateJson` middleware now validates JSON syntax early and returns 400 rather than allowing handlers to surface unhandled 500 errors.
- Fixed permanent memory leak in SSE stream handler: `await new Promise(() => {})` replaced with a resolvable promise; stream now cleanly resolves on client disconnect.
- Fixed race condition in SSE double-cleanup: added `cleanedUp` guard to prevent `broadcaster.removeClient` from running twice on concurrent abort and error, including initial write/replay failures.
- Project SQLite database cache now evicts the oldest entry when it exceeds 50 entries, preventing unbounded memory and file-descriptor growth.
- `startingTickets` set now cleaned up in a `finally` block, preventing permanent blocking of ticket starts after unexpected errors.
- `isLoopbackHost` and `isLocalhostRequest` now recognise IPv4-mapped IPv6 loopback addresses (`::ffff:127.0.0.1`, `::ffff:7f00:1`).
- Basic auth header builder now validates that the username does not contain `:` (RFC 7617 compliance).

### Performance
- OpenCode text/reasoning live AI detail updates now use a 10ms live cadence with no large-growth bypass, making thinking/model output feel closer to tool-call responsiveness while keeping streaming upserts out of persisted log files until a final row is emitted.
- `npm run dev` startup logs are quieter by default while preserving dependency/audit summaries in the normal startup output.
- Dev port inspection now avoids `netstat` unless earlier inspectors cannot identify the listener, removing noisy platform warnings during normal startup while preserving fallback diagnostics in verbose mode.
- `contextCache` in `contextBuilder.ts` now evicts stale entries on cache misses, preventing unbounded accumulation in long-running processes.
- `persistedFingerprintsByTicket` map capped at 100 entries to prevent unbounded memory growth.
- Pre-compiled credential-redaction regex in `errorDiagnostics.ts` (was re-created on every call).
- `errorDiagnostics` `modelId` and similar fields now computed once and reused instead of double-sanitising.

### Bug Fixes
- OpenCode live AI detail streaming now reads the SDK global event feed and filters it back to the active session, restoring real-time thinking/tool/output rows after the `@opencode-ai/sdk` 1.14.48 event behavior change while keeping the existing streaming throttle.
- AI detail logs now backfill finalized thinking, tool, and step rows from all OpenCode assistant message parts for the completed prompt, so AI/model tabs can restore extended tool-use histories even when the browser was not open during the phase or the live event stream closed early.
- Ticket dashboards now normalize partially cached ticket runtime/action/model data before rendering, preventing a full-page crash during fast start and workflow phase transitions.
- `isRecord` type guard now correctly excludes `Date`, `Map`, and `Set` instances.
- `parsePort` now accepts only digit-only TCP port strings so malformed values like `"3000abc"`, `"123.4"`, or `"300e0"` fall back instead of being partially accepted.
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
- Completed log entries are no longer entry-count capped in the log API or browser cache; server log files remain the durable source of truth, while streaming partials are still folded to avoid repeated in-progress snapshots.

### Configuration
- `vitest.config.ts`: all test projects now use `isolate: true` to prevent test state leakage.
- `tsconfig.json`: `scripts/` directory added to `include` so dev scripts are fully type-checked.

## [0.1.0] - 2026-04-27

- Clarified the README around local AI coding orchestration for repo-scale work, LLM Council planning, Ralph-loop recovery, OpenCode worktrees, and human-in-the-loop PR automation.
- Added repository trust files for licensing, security reporting, contribution flow, conduct expectations, citation metadata, issue templates, and pull request review.
- Added a GitHub social preview asset for shared repository links.
