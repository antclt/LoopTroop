# Changelog

All notable changes and official releases for LoopTroop are documented here.
Unreleased changes appear first and represent commits that have not yet been included in a versioned release.

---

## Unreleased

### Summary
- Added profile-controlled OpenCode retry budgets so transient provider stalls block early with diagnostics and same-session Continue instead of burning coding retries.
- Extended the ticket disk space card in the details view to allow expanding any category (Source Code, Phase Artifacts, or Execution Logs) to see which specific folders/files are occupying space, rendered in a beautiful HSL dark-mode monochrome interactive accordion.
- Added a beautiful button and card to calculate and display ticket disk space usage with granular breakdown by logs, artifacts, and source code.
- Made manual Retry preserve versioned logs and artifacts for every non-implementation failed status while keeping CODING bead-scoped.
- Made documentation screenshots collapsible and clickable, with expanded bead error screenshots on the docs home page.
- Consolidated changelog maintenance into the docs changelog while keeping a root pointer for discoverability.
- Prevented first-interaction crashes when a lazy UI module fails to load during dev startup.
- Made versioned coverage reports keep version transitions in order while defaulting to the latest check and suppressing stale open-gap lists.
- Clarified the `npm run dev` startup summary with an explicit package release-age gate note.
- Added a beautiful Changelog documentation page positioned above the Roadmap.
- Made Full Answers parsing more resilient to malformed YAML formatting while preserving approved interview metadata.
- Kept the left-panel Errors header compact while showing real bead counters in expanded coding-error labels.
- Made OpenCode runtime setup permissive and self-healing while keeping missing execution tooling as a hard setup blocker.
- Made OpenCode session startup more resilient with bounded app-wide retries and health diagnostics.
- Added an opt-in `npm run dev --opencode-logs=all` mode for full managed OpenCode DEBUG logs in the terminal.
- Audited and corrected all user-facing status descriptions, Details content, and documentation for accuracy and consistency.

### Detailed Changes

#### Added
- Added profile settings for `OpenCode Retry Limit` and `OpenCode Retry Grace Window`, exposed through the API, Configuration UI, and documentation with defaults of 10 retry events and 60 seconds.
- Added recursive nested file and folder expansion directly in the ticket disk space details view, incorporating standard monochrome folder/file icons, exact size formatting, and custom collapsible sub-accordions with smooth transitions.
- Added full recursive top-level and category child listings with sizes in the Hono ticket size API endpoint (`/tickets/:id/size`).
- Added a ticket disk space calculation card under the Artifacts Location in details view with a premium themed button, interactive hover effects, live loading state, error alert banner, and on-demand recursive disk size computation broken down by Source Code, Phase Artifacts, and Execution Logs.
- Added a `GET /tickets/:id/size` route to Hono backend for recursively measuring ticket worktree folders using safe non-symlink-following `lstat` concurrency, computing precise space breakdowns for logs, artifacts, and source files.
- Added a robust integration test `server/routes/__tests__/tickets.size.test.ts` verifying exact and recursive file size aggregation and granular category splits.
- Added two bead error screenshots to the docs home page and a docs-wide image lightbox so screenshots can be opened nearly full screen with a top-right close button.
- Added a dedicated `Changelog` documentation page (`docs/changelog.md`) detailing LoopTroop's official release history starting from release `0.1.0`.
- Integrated `/changelog` route into both VitePress sidebar and top navbar navigation.
- Added `npm run dev --opencode-logs=all` to print full managed OpenCode DEBUG logs with `--print-logs --log-level DEBUG`, plus `LOOPTROOP_OPENCODE_LOGS=all` for direct watcher launches.

#### Changed
- Manual Retry from `BLOCKED_ERROR` now archives and creates fresh phase attempts for every non-implementation status, including runtime setup and post-implementation phases, while `CODING` keeps its existing failed-bead reset and retry history.
- Wrapped the docs home-page screenshots in collapsed-by-default details sections so only each screenshot title is visible until expanded.
- Made `docs/changelog.md` the canonical full changelog, including unreleased changes, and replaced the root `CHANGELOG.md` with a discoverability pointer.
- `npm run dev` now prints a short multi-line package gate note in the startup summary, making it clearer that direct npm dependency updates and audit fixes wait until package releases are 7 days old while OpenCode updates immediately.
- Updated `@opencode-ai/sdk` from `1.15.5` to `1.15.6`.
- `npm run dev` now starts managed OpenCode servers with `OPENCODE_PERMISSION='"allow"'` by default, while `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` lets external permission policy pass through unchanged.
- Workspace setup prompts now treat missing required command launchers as setup gaps, attempt user-space provisioning under `.ticket/runtime/execution-setup/tool-cache`, record reusable `env.sh`/`run` wrapper artifacts, and tell coding/final-test agents to run setup-dependent commands through the wrapper.
- Execution setup retries now preserve the ticket-owned `tool-cache` while clearing stale profile and wrapper state, and stop early when the same tooling blocker repeats after provisioning fails.
- Updated `BLOCKED_ERROR` status description to include the `Continue` action alongside `Retry`, with accurate detail on eligibility and session behavior; aligned `DRAFTING_PRD` description to note that structured retries are exhausted before a PRD draft is skipped.
- Replaced all opaque internal prompt IDs (`PROM4`, `PROM_CODING`, `PROM51`, `PROM25`) with plain English descriptions in `shared/workflowMeta.ts`, `docs/execution-loop.md`, `docs/ticket-flow.md`, and `docs/configuration.md`; replaced internal constant names (`BEAD_STATUS_SCHEMA_REMINDER`, `CONTINUE_CODING_SCHEMA_REMINDER`, `shouldUseStructuredRetry`, `buildContinuationPrompt`, `perIterationTimeoutMs`) with conceptual descriptions in the CODING Details steps.
- Removed stale `COMPLETED` note that incorrectly implied the candidate branch had not yet been merged (the merge decision is finalized in `WAITING_PR_REVIEW` before `COMPLETED` is reached).
- Synced all eight out-of-date rows in the `docs/state-machine.md` Phase Descriptions table with their canonical `description` fields in `shared/workflowMeta.ts`.
- Refined PRD coverage status description to clarify in-phase revision loop instead of implying cross-state transitions.
- Clarified PRE_FLIGHT_CHECK status description to note the minimal AI connectivity probe instead of broadly stating "No AI context is passed."
- Annotated dead `GAPS_FOUND` state machine transitions for PRD and beads coverage phases as defensive-safety artifacts since coverage loops internally.
- Added JSDoc to all exported types, interfaces, and functions across `shared/workflowMeta.ts`, `src/lib/workflowMeta.ts`, `WorkspacePhaseSummary.tsx`, `ticketMachine.ts`, and `ticketQueries.ts`.
- Documented the dynamic `continue` action injection on `getAvailableWorkflowActions` with a reference to `addContinueActionWhenAvailable`.
- Annotated the unused `votes` context key as reserved and added a note to `CONTEXT_KEY_LABELS`.

#### Fixed
- OpenCode `session.status` retry events for rate limits, usage limits, overload/capacity, temporary unavailability, timeouts, and network/socket failures now block through `BLOCKED_ERROR` after the configured budget, preserving provider diagnostics and active sessions for Continue when eligible.
- CODING now routes continuable OpenCode/provider retry exhaustion through the normal blocked-error path instead of converting it into bead retry exhaustion, while ordinary implementation failures keep the existing bead reset/retry behavior.
- Active bead countdowns now reset their start timestamp when a new coding iteration/session begins, preventing the UI from sticking at `00:00/20:00` while later iterations continue.
- Left-panel blocked-error headers now stop appending active bead identifiers after the count and Active badge, preventing long bead names from overflowing the navigator while preserving details in the expanded error view.
- Coding error occurrence labels now use the ticket's runtime bead counters, so left-panel rows and blocked-error headers show labels such as `Implementing (Bead 2/5)` instead of the generic `Bead ?/?` fallback.
- Lazy-loaded Configuration, ticket creation, project, and workspace views now automatically refresh once after recoverable dynamic-import/chunk-load failures, avoiding the root crash screen caused by transient first-load module fetch races.
- Coverage reports now show the latest open-gap status by default after ordered version transitions, suppress stale open-gap lists when no gaps remain, and switch gap headings/lists to the selected `v1 > v2` or `v2 > v3` transition.
- Fixed date rendering on the Changelog documentation page by formatting version dates as clean, standard parentheses text, avoiding raw unparsed HTML badge tags.
- Full Answers normalization now restores canonical `follow_up_rounds` when a model emits malformed round metadata and repairs common multiline `free_text` YAML formatting without changing answer text.
- Bead commits now exclude execution setup temp roots, reusable setup artifact roots, and legacy `.cache/project-tooling/**` files so temporary toolchains cannot be recorded as implementation work.
- OpenCode session creation now retries the initial attempt up to three times with bounded backoff, collecting lightweight health diagnostics after failures while preserving cancellation and timeout behavior.

---

## 0.2.1 (2026-05-20)

### Summary
- Added a profile-level Structured Output Retries setting that is locked per ticket and now covers PR draft parsing before GitHub side effects.
- Standardized automatic retry inspection in Raw tabs and manual retry review through archived phase versions.
- Kept structured retry audit controls clearer by making model labels passive, labeling validated retry outputs with their attempt number, and limiting intervention warnings to the primary artifact tab.
- Kept structured adjustment notice badges aligned with the fixes and retry attempts shown in expanded details.
- Removed duplicate Raw selector tabs so identical payloads appear once, preferring per-attempt retry tabs over generic raw-output shortcuts.
- Kept single-model Raw views focused by omitting the aggregate selector when only one model source has raw output.
- Kept Raw attempt inspection focused by removing stored artifact JSON shortcuts and grouping single-model attempts under model/mode labels.
- Kept Raw attempt buttons in numeric attempt order across statuses.
- Kept voting-phase winner artifact Raw views scoped to the winning draft instead of vote scorecards.
- Kept previous draft Raw views canonical after drafting by showing only the validated draft in voting/refining artifacts.
- Raised the OpenCode event-listener warning threshold to reduce noisy stream warnings during parallel ticket activity.
- Made `npm run dev` startup maintenance output include package names, version changes, and held-release eligibility times by default.
- Added a global reconnecting banner that appears on all views when the backend is unreachable, polling every 3 seconds.
- Fixed error navigation from Full Log so selecting an error opens its review view.
- Fixed coverage reports so unresolved PRD, interview, and blueprint gaps are visible from the report instead of only approval warnings.
- Kept human-input workflow phases visually paused by replacing left-timeline spinners with static waiting indicators.
- Improved blocked-error diagnostics so OpenCode usage-limit failures remain visible when structured coverage output is empty.
- Made blocked-error diagnostics explain when AI output was cut off by an OpenCode/model length stop, including finish reason and token counts.
- Added a Continue recovery action for eligible blocked OpenCode sessions so temporary model interruptions can resume without starting a fresh phase attempt.
- Preserved ticket artifacts during execution resets so retries no longer lose bead plans or planning context.

### Detailed Changes

#### Added
- Added configurable structured-output retry counts with profile/API/UI validation, ticket-start locking, and documented continued-session versus fresh-session retry classes.
- Added structured retry for pull request title/body drafting before branch push or PR create/update, with diagnostics and deterministic fallback text when parsing remains invalid.
- Added raw attempt persistence for PRD/interview/beads refinement, relevant-files scan, coverage audit/revision, execution setup plan/runtime generation, and final-test generation.
- Added Raw tab variants for structured artifacts with `rawAttempts`, including diagnostic entries when a retry failed before model text existed.
- Added a global backend reconnecting banner in the app header that polls `/api/health` every 3 seconds and shows an amber "Reconnecting to server…" badge whenever the backend is unreachable, covering all views including the Kanban board.
- Added a conditional `Continue` action for `BLOCKED_ERROR` tickets with resumable OpenCode/provider diagnostics and a matching active preserved session; it dispatches `CONTINUE` and sends exactly `continue please` to the same OpenCode session.

#### Changed
- Replaced hardcoded one-shot structured retries across scanning, interview/PROM4 parsing, PRD/beads planning, coverage repair, execution setup, coding marker repair, and final-test generation with the locked ticket retry count while keeping broader workflow attempt budgets separate.
- Documented the four retry classes and standardized status/details wording around **continued session**, **fresh session**, and broader **new attempt** loops.
- Manual Retry from `BLOCKED_ERROR` now archives the failed tracked phase attempt and creates a fresh active attempt before rerunning, so rerun artifacts and logs are versioned separately.
- Blocked-error history now records `CONTINUED` resolutions separately from `RETRIED`, and CODING continuation preserves the interrupted bead/session instead of running the normal reset-first retry recovery.
- Canonical artifact flow keeps rejected malformed model output diagnostic-only while downstream phases continue to consume accepted normalized content.
- Structured artifact viewers now keep parser/retry intervention notices on the primary artifact tab, while retry producers share one raw-attempt helper so accepted/rejected attempt metadata stays consistent across phases.
- Made grouped Raw selector model labels passive metadata, labeled validated retry outputs with their accepted attempt number, and deduplicated identical Raw variants, with per-attempt retry/validated tabs preferred over generic `Raw Output`, `Model Output`, `Accepted Output`, `Validated`, or `Rejected` shortcuts.
- Removed explicit stored `Artifact JSON` Raw variants from structured attempt viewers; Raw now focuses on model output attempts grouped under their model/mode source label.
- Raw attempt variants now retain numeric attempt order after duplicate raw/model-output shortcuts are collapsed, with log-derived rejected retry shortcuts labeled by their inferred attempt number.
- Added a project-level OpenCode plugin that sets the Node/Bun event listener warning threshold to 20 inside the OpenCode process.
- Development maintenance output now renders a single default startup summary with package-level dependency update details, held direct dependency details, and held audit remediation eligibility times.
- Removed the separate verbose dev-startup mode so dependency maintenance details appear in normal `npm run dev` output.
- The `npm run dev` startup summary now prints the docs URL once instead of repeating its port as a suffix.

#### Fixed
- ApprovalView tests now mock the async UI-state save mutation used by debounced approval draft persistence, preventing timer-driven false failures during full-suite runs.
- Selecting an error from the navigator while Full Log is open now exits full-log mode and opens the error review.
- Blocked coverage errors now preserve underlying OpenCode retry/provider diagnostics, such as usage limits, and avoid repeating an identical parser-wrapper message in the error details.
- Structured-output failures caused by OpenCode `finish_reason=length` are now classified as output truncation and shown in the blocked-error underlying details instead of only surfacing secondary parser messages like missing fields.
- Single-model Raw artifact views no longer show a redundant aggregate selector; raw, validated, and retry variants remain available under the model source.
- Voting-phase winner artifacts now ignore vote-phase model logs when draft raw output is missing, so Raw and validated views stay focused on the selected draft across interview, PRD, and beads voting.
- Previous draft artifacts shown after their drafting phase now render only the validated draft in Raw, keeping rejected/raw model text scoped to the original drafting diagnostics while downstream phases show the canonical content they actually consume.
- Structured artifact notice badges now count the owner-level fixes and retry attempt totals shown in expanded details, so aggregate vote details and multi-retry council drafts no longer underreport adjustments.
- Coverage reports now render the current open gap list from `remainingGaps`, `gaps`, `parsed.gaps`, or the latest gap attempt so terminal cap warnings match the inspectable report details.
- Needs-input phases now use static waiting indicators in the left timeline, and workspace setup approval now follows the same side-navigation styling as the other approval gates.
- Execution setup, coding, and final-test retry resets now preserve LoopTroop-owned `.ticket` artifacts while still rolling back project file changes.

---

## 0.2.0 (2026-05-12)

### Summary
- Added expanded runtime diagnostics, output-normalization documentation, operations guidance, configuration reference material, and refreshed onboarding docs.
- Added richer ticket/workspace surfaces for setup-plan review, regenerated approval versions, raw/rejected artifact inspection, live phase logs, GitHub links, and completed-ticket worktree cleanup.
- Added broader test coverage across middleware, routes, workflow phases, logs, structured output repair, UI components, dev maintenance, and diagnostics.
- Refined the planning flow around interview/PRD approval edits, member-specific council artifacts, winner-model context, coverage warnings, and beads planning.
- Improved dashboard and workspace ergonomics with tighter status chrome, clearer phase summaries, better artifact rendering, keyboard/menu fixes, and more resilient ticket normalization.
- Updated development maintenance behavior so dependency sync, npm audit remediation, and OpenCode maintenance are coordinated through the startup preflight.

### Detailed Changes

#### Added
- Added expanded runtime diagnostics, output-normalization documentation, operations guidance, configuration reference material, and refreshed onboarding docs.
- Added richer ticket/workspace surfaces for setup-plan review, regenerated approval versions, raw/rejected artifact inspection, live phase logs, GitHub links, and completed-ticket worktree cleanup.
- Added broader test coverage across middleware, routes, workflow phases, logs, structured output repair, UI components, dev maintenance, and diagnostics.

#### Changed
- Refined the planning flow around interview/PRD approval edits, member-specific council artifacts, winner-model context, coverage warnings, and beads planning.
- Improved dashboard and workspace ergonomics with tighter status chrome, clearer phase summaries, better artifact rendering, keyboard/menu fixes, and more resilient ticket normalization.
- Updated development maintenance behavior so dependency sync, npm audit remediation, and OpenCode maintenance are coordinated through the startup preflight.

#### Security & Reliability
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

#### Performance
- OpenCode text/reasoning live AI detail updates now use a 10ms live cadence with no large-growth bypass, making thinking/model output feel closer to tool-call responsiveness while keeping streaming upserts out of persisted log files until a final row is emitted.
- `npm run dev` startup logs are quieter by default while preserving dependency/audit summaries in the normal startup output.
- Dev port inspection now avoids `netstat` unless earlier inspectors cannot identify the listener, removing noisy platform warnings during normal startup while preserving fallback diagnostics in verbose mode.
- `contextCache` in `contextBuilder.ts` now evicts stale entries on cache misses, preventing unbounded accumulation in long-running processes.
- `persistedFingerprintsByTicket` map capped at 100 entries to prevent unbounded memory growth.
- Pre-compiled credential-redaction regex in `errorDiagnostics.ts` (was re-created on every call).
- `errorDiagnostics` `modelId` and similar fields now computed once and reused instead of double-sanitising.

#### Bug Fixes
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

#### Configuration
- `vitest.config.ts`: all test projects now use `isolate: true` to prevent test state leakage.
- `tsconfig.json`: `scripts/` directory added to `include` so dev scripts are fully type-checked.

---

## 0.1.0 (2026-04-27)

### Summary
- Clarified the README around local AI coding orchestration for repo-scale work, LLM Council planning, Ralph-loop recovery, OpenCode worktrees, and human-in-the-loop PR automation.
- Added repository trust files for licensing, security reporting, contribution flow, conduct expectations, citation metadata, issue templates, and pull request review.
- Added a GitHub social preview asset for shared repository links.
