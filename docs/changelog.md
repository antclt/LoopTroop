# Changelog

All notable changes and official releases for LoopTroop are documented here.
Unreleased changes appear first and represent commits that have not yet been included in a versioned release.

---

## Unreleased

### Summary

### Detailed Changes

---

## 0.2.4 (2026-05-28)

### Summary
- Added live-only workspace status progress labels for coding, coverage checks, and retried phases.
- Made merged PR completion independent of the user's local checkout cleanliness.
- Fixed long ticket descriptions being unscrollable in backlog and detail views.
- Enabled setup-scoped online artifact lookup for missing launcher provisioning while keeping real provisioning evidence stricter.
- Fixed realtime logs for active multi-attempt phases while keeping archived phase versions static and attempt-scoped.
- Hardened execution setup so missing launcher failures must show persistent provisioning attempts before blocking.
- Hardened setup reuse so final testing automatically runs through validated prepared environments.
- Improved workspace setup approval logs so generation starts visibly expanded and collapses once the setup plan is ready.
- Added a one-step rewind from Preparing Workspace Runtime back to setup-plan approval for safe edits and regeneration.
- Fixed runtime setup rewinds so regeneration starts only the requested setup-plan session instead of racing an automatic draft.
- Made future bead commits language-agnostic while blocking setup-created project dirt before coding starts.
- Consolidated concurrent AI status messages and warnings into a premium collapsible activity strip below workspace logs with persistence.
- Fixed stale Current Activity timeout warnings when reviewing phases that already passed.
- Made PRD coverage revisions tolerate safe change-metadata aliases while preserving validated structural review diffs.
- Added tooltip to the CMD log tab in phase and full log views, consistent with all other log tabs.
- Raw tab in artifact views now defaults to the validated variant (or first accepted attempt) instead of the first non-disabled variant. When multiple model sources exist, the first validated model is auto-selected.
- Added dynamically calculated bead implementation time below Completed At in CodingView's bead details panel.
- Improved stall diagnostics with trend-wide process attribution and focused ticket runtime artifact sizing.
- Fixed completed ticket navigation so the historical Implementing row shows the final bead count.

### Detailed Changes

#### Added
- Added trend-wide top system CPU/RSS/read/write attribution and a `--ticket-path` option to `npm run diagnose:stall`, so reports can identify memory/I/O spike owners and inspect a specific ticket runtime's logs, largest directories, and large build artifacts.
- Added dynamically calculated bead implementation time (Completed At minus Started At) under the Timeline section in the CodingView's bead details panel, rendered on the fly when both timestamps are available and represent a valid positive duration.
- Added live-only progress wording to the workspace status title: CODING now names the active bead and iteration, coverage phases show pass/version progress when known, and manually retried non-implementation phases show the active retry attempt while the status is live.
- Raw artifact tab now defaults to the validated variant when available. When multiple model sources exist (e.g. council drafts, votes), the first source with a validated variant is auto-selected. Falls back to the first non-disabled variant when no validated variant exists.
- Added an `Initial Prompt` selector to future model-produced Raw attempt views when the first prompt is persisted, making the model input inspectable beside accepted and rejected attempt outputs without inferring legacy prompts from logs.
- Added a guarded setup-plan rewind while `PREPARING_EXECUTION_ENV` is active, letting users edit or regenerate the approved setup plan after runtime setup starts while preserving archived runtime evidence.
- Added setup-scoped OpenCode `websearch`/`webfetch` access during `PREPARING_EXECUTION_ENV`, with managed dev OpenCode servers started using `OPENCODE_ENABLE_EXA=1`, so agents can resolve official launcher artifact metadata when local repository evidence is insufficient.
- Added `tool_requirements.provisioning_attempts` evidence to execution setup profiles so failed required-launcher setup records distinct temp-root provisioning strategies and commands, or why no safe provisioning path exists.
- Added `tooling_probe_commands` to execution setup profiles so prepared language/toolchain environments can be verified by model-selected, non-mutating probes before coding starts.
- Added pre-flight and execution-setup worktree cleanliness checks: pre-existing committable project changes now block before setup, ready setup attempts fail if they leave committable project changes, and untracked generated/local noise is reported with `.gitignore` suggestions.
- Added support for tracking multiple parallel AI model activities and diagnostics concurrently.
- Added state persistence to localStorage for the collapsible activity strip, saving user preferences across reloads.
- Added a **"Create and Start"** button to the New Ticket modal, letting users create a ticket and immediately trigger the workflow from a single action.

#### Fixed
- Completed and later-phase tickets now keep the last known bead progress on the left-panel Implementing timeline row, showing labels such as `Implementing (Bead 8/8)` instead of the generic `Bead ?/?` fallback.
- Runtime setup rewinds now suppress the restored approval actor's immediate auto-draft when the route is about to save an edited plan or start a commented regeneration, preventing duplicate setup-plan sessions and last-writer-wins overwrites.
- The CMD log tab now shows a descriptive tooltip on hover, matching the tooltip behavior of all other log tabs (ALL, SYS, AI, ERROR, DEBUG).
- Long ticket descriptions are now independently scrollable (300px max-height with overflow) in the Ticket Details modal, DraftView, and PhaseReviewView. Previously, long descriptions expanded indefinitely and pushed other content off-screen.
- Viewing the active (latest) version in multi-attempt phases now keeps using realtime SSE logs while filtering to that active `phaseAttempt`. Archived phase versions remain static/read-only and load their durable attempt-scoped log snapshot, preventing both missed live runtime setup logs and cross-attempt log mixing.
- Current Activity timeout warnings now render only for the ticket's live status, so revisiting an older phase cannot show an obsolete `Approaching timeout` banner until refresh.

#### Changed
- PR merge completion now verifies that `origin/<baseBranch>` contains the candidate commit and proceeds to cleanup without checking out, fast-forwarding, or requiring cleanliness in the user's main project folder.
- Renamed Raw retry attempt selectors to the clearer `Attempt N Output - Accepted/Rejected` format.
- Setup-plan edits and regenerations from active runtime setup now stop the runtime session, archive the approved setup contract and runtime attempt, clear stale runtime profile outputs while preserving the tool cache, and require approval again before setup reruns.
- Execution setup prompts now state that wrapper creation, cache inspection, PATH edits, and version probes are discovery/scaffolding only, and do not count as provisioning strategies unless the attempt actually obtains, installs, or activates the missing launcher under approved temp roots.
- Execution setup prompts now treat failed launcher version/info probes as discovery only, replacing single-ecosystem provisioning guidance with non-exhaustive Node, Python, and JavaScript-runtime examples plus permission to use any safe repository-appropriate temp-root provisioning approach.
- Execution setup now requires at least two distinct failed provisioning strategies before accepting terminal failed-tooling evidence, and grants a small bounded persistence retry extension when the base setup budget is exhausted after only one real strategy.
- Final-test command execution now reuses a validated execution-setup wrapper automatically when one is declared, recording both the original command and the effective wrapped command in the report.
- Workspace setup approval now keeps the live log drawer expanded while LoopTroop is generating the setup plan, then automatically collapses it when the plan artifact becomes visible for review.
- Execution setup now fails early when declared wrappers are missing or unusable, probes fail, or wrapper/project command families are declared without probes.
- Changed bead commit capture to be language-agnostic. LoopTroop now commits Git-visible project changes regardless of extension, while still excluding `.ticket/**`, `.looptroop/**`, execution-setup roots, and untracked generated/local outputs.
- Execution setup prompts now ask agents to record suggested `.gitignore` entries in profile cautions instead of editing `.gitignore` during setup.
- Re-engineered the Current Activity strip below the log tabs to be fully collapsible and display a list of all active model sessions, beads, and warnings.
- Redesigned the strip UI with premium unified severity styling (Error > Warning > Info) and smooth chevron transitions on toggle.

---

## 0.2.3 (2026-05-26)

### Summary
- Added future-ticket safety around PR merge completion and final-test file effects so merged PRs and test-produced files are handled audibly and recoverably.
- Format commands in system logs to match tool calls exactly, using identical colors (`text-cyan-500`) and rendering output/error blocks in standard structured sections (squares/boxes) regardless of length.
- Render bead separators in the per-phase normal log view for CODING phase, matching the existing Full Log bead grouping behavior.
- Resume execution-setup and final-test attempt counters correctly after an app restart, so logs show the true attempt number and the maxIterations guard is respected across restarts.
- Fixed bead iteration countdown timer showing 00:00 on iteration 2+ by anchoring to the current iteration's start time (`updatedAt`) instead of the first iteration's start time (`startedAt`).
- Pause the CODING bead countdown while a ticket is blocked by a continuable provider interruption, and show a paused-session cue instead.
- Repair bare structured YAML list item keys before parsing so compatible model outputs no longer retry when they emitted an existing id/path as a scalar.
- Show a live Current Activity strip above log views so model stalls, empty outputs, trusted timeout causes, and near-deadline warnings are visible while waiting.
- Apply AI Response Timeout consistently to model-output waits across scan, planning, final-test generation, and PR drafting phases while keeping CODING on its bead iteration timeout.
- Separate CODING iteration timeouts from OpenCode/provider interruptions so owned bead deadlines reset and retry while resumable provider stalls can still Continue.
- Make the ticket location copy path button permanently visible in the ticket details view, and add an OS-agnostic 'Reveal in File Explorer' button next to it.
- Show line count, interactive color legend, and copy button in the per-bead model log view.
- Show index-based bead numbers next to bead titles and IDs in the beads details view (blocked by, blocks, and label matching lists) and draft views.
- Fixed bead `startedAt` to preserve the first iteration's start time across retries instead of overwriting it on each attempt; changed bead `createdAt` to be set at approval time (when user clicks Approve) instead of on save or expansion.
- Added and hardened `npm run dev --lan` for trusted local-network dashboard sharing with LAN URLs, a mobile QR code, and WSL-aware Windows portproxy diagnostics.
- Let users collapse the left-panel Errors section even when a blocked ticket auto-opens it.
- Reload only after sustained dashboard reconnect/loading recovery so transient warning flickers do not refresh the page.
- Show exact sanitized OpenCode provider causes when generic provider errors can be matched to local OpenCode logs.
- Make Continue recovery use exact OpenCode session lookup and show failed action reasons inline.
- Allow Continue for blocked `HTTP 402 Payment Required` OpenCode provider errors when the original session is still active.
- Show live `npm run dev` preflight progress so slow startup checks no longer look stalled.
- Added a manual reload button next to "AI Models" in Configuration to force-refresh available OpenCode providers and models on demand.
- Keep future `.ticket/**` metadata local to LoopTroop so ticket artifacts no longer get committed or pushed to target repository branches.
- The DEBUG tab now shows every single log line from LoopTroop (all three channels) and OpenCode (all SDK stream events plus native server logs); OpenCode native logs are always written at DEBUG level to the log directory. Use `npm run dev --opencode-logs=all` to additionally print them to the console.
- Added a high-priority roadmap item for an AI Gap-Fix Button on coverage warnings during approval statuses, letting the main AI implementer resolve unresolved coverage gaps in-place.
- Successful `git push` commands now show a compact `→ push completed` log entry instead of the verbose multi-line `STDERR:` remote messages block.
- Show a visible notification in the ALL tab whenever an OpenCode session is restarted due to no response text being produced, making silent session resets visible across all workflow phases.
- Added **OpenCode Max Steps** profile setting to cap the number of steps per OpenCode session; when set, LoopTroop writes a per-worktree `opencode.json` (git-excluded) before coding and removes it after; 0 means no limit (OpenCode default).
- Fixed release validation coverage for the OpenCode Max Steps documentation link and normalized roadmap line endings.

### Detailed Changes

#### Added
- Added language-agnostic final-test file-effects auditing. Final-test structured output now accepts `file_effects` entries (`candidate`, `temporary`, or `unexpected`), records baseline/post-test dirty files in a `final_test_file_effects_audit` artifact, and blocks integration with `FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED` when final testing leaves undeclared dirty files.
- Added blocked-error recovery actions for unresolved final-test file effects: **Include in PR** writes a `final_test_file_effects_override` that treats unclassified final-test-produced files as candidate changes, while **Discard and Continue** removes/reverts only files proven by the audit to have been produced or changed during final testing.
- `emitOpenCodeSessionLogs` now emits an `audience: 'all'` milestone notification when `responseChars=0`, making silent OpenCode session restarts visible in the ALL tab across all workflow phases (coding, PRD, interview, verification, PR drafting, etc.).
- New **OpenCode Max Steps** profile setting (`opencodeSteps`, default `0`): caps the number of steps per OpenCode session. When set to a non-zero value, LoopTroop writes `opencode.json` at the worktree root before coding starts (git-excluded via per-worktree local exclude) and removes it in a `finally` block after coding completes. `0` means no limit — matching OpenCode's default behavior.
- Added `opencodeSteps` to DB schema (`opencode_steps INTEGER DEFAULT 0`), Drizzle ORM profile schema, Zod profile route schema, frontend `Profile` interface, `numericFields` config, `buildInitialRawNumeric`, and `ProfileSetup.tsx` with a `NumericField` control and inline hint.
- Added **OpenCode Max Steps** section to `docs/configuration.md` covering steps-vs-messages semantics, trade-offs, and git-exclusion implementation detail.

#### Changed
- PR merge completion now treats the GitHub merge as complete once GitHub reports the PR merged. Local base-branch sync runs afterward as a recoverable follow-up, and retries for already-merged PRs skip the remote merge call and resume local sync/cleanup.
- New ticket worktrees now fetch `origin` before resolving their base and prefer `origin/<baseBranch>` when that remote ref is available.
- Successful `git push` with informational remote STDERR is now rendered as a compact `→ push completed` log entry in `commandLogger`, suppressing the verbose multi-line `STDERR:` block.
- Changed command tag `[CMD]` and text colors to match tool logs (`text-cyan-500`) instead of `text-zinc-500`.
- Bypassed the length/complexity filter (`shouldRenderImplicitStdoutSection`) in `splitLegacyCommandBody` to ensure compact command outputs are always rendered as structured `STDOUT` or `ERROR` boxes.
- Updated `PhaseLogPanel` tests to align with the standard structured formatting of all command outputs.
- Broadened the existing `councilResponseTimeout` setting into the user-facing AI Response Timeout, covering non-coding model-output prompts including relevant-files scanning, setup-plan drafting, final-test generation, and PR drafting; CODING and execution setup keep their dedicated timeout behavior.
- Removed the hover-only opacity constraint from the copy path button in the ticket details view, making it permanently visible.
- Show the 1-based index (bead number) next to dependency references (Blocked By, Blocks) and label matching lists in the bead details view trigger and hover cards to easily locate them in the main bead list.
- Display index-based bead numbers next to dependencies (Blocked By, Blocks) in the collapsible Beads draft artifact details view.
- Bead `startedAt` now preserves the first iteration's start timestamp across retries instead of being overwritten on each attempt. Only `updatedAt` reflects the latest attempt start time.
- Bead `createdAt` is now stamped at approval time (when the user clicks Approve) instead of at save or expansion time. Beads start with `createdAt: ''` and receive their timestamp only when approved.
- Ticket worktree artifacts under `.ticket/**` now stay local: project attach installs `/.ticket/` in `.git/info/exclude`, and bead finalization excludes those files from commit capture while still preserving them across execution resets.

#### Added
- Added bead delimiter separators to the per-phase normal log view for the CODING phase. Log entries are grouped by detected bead boundaries (from `[SYS] Executing bead ...` system lines) and each bead section is preceded by a `Bead X/Y` delimiter showing the bead title, matching the existing Full Log behavior. Incomplete future beads are hidden when runtime data is available, and the grouping respects the current tab filter so empty bead sections are omitted.
- Added a compact Current Activity strip to phase and full log views, deriving waiting-for-first-model, provider retry timeout, provider-timeout-preserved, iteration-timeout, empty-output, workflow timeout, and near-timeout states from structured log events.
- Added a 'Reveal in File Explorer' button next to the copy path button in the ticket details view.
- Added a POST `/api/files/open-path` API endpoint that safely reveals files/folders in the user's native file explorer, supporting Windows, macOS, Linux, and WSL (including WSL path to Windows host conversion).
- Added entry count, interactive color legend tooltip, and copy-to-clipboard button to the per-bead Log view (in the bead details pane) matching the standard dashboard phase/full log view headers.
- Added a LAN sharing mode for `npm run dev --lan`, binding the frontend/docs dev servers to the local network, advertising reachable LAN URLs with a QR code, and keeping backend/OpenCode control-plane ports loopback-only behind the Vite proxy.
- Replaced automatic WSL relay startup with a safe Windows portproxy one-liner for `npm run dev --lan`, avoiding suspicious PowerShell listener processes while explaining why WSL `172.x` addresses are not directly reachable from other LAN devices and keeping the mobile QR code for the after-setup URL.
- Added WSL LAN setup diagnostics that check whether the matching Windows network profile is Private, print the exact `Set-NetConnectionProfile` command when the profile is Public, run a Windows-side reachability self-test for the forwarded frontend/docs URLs, and explain that router/AP client isolation cannot be reliably detected from the dev machine.
- Added a reload button with tooltip next to the "AI Models" heading in the Configuration panel. Clicking it clears the React Query cache and re-fetches the full model catalog from the OpenCode server, bypassing the 5-minute stale-time window.
- The DEBUG tab now loads `channel=all`, which merges all three LoopTroop log files (`execution-log.jsonl`, `execution-log.debug.jsonl`, `execution-log.ai.jsonl`) plus OpenCode native server log lines filtered by the ticket's session IDs. Every LoopTroop log entry and every OpenCode SDK stream event is visible in a single chronological view. All content is loaded lazily on tab open; no other tabs are affected.
- Added `channel=all` to the log API (`GET /api/files/:ticketId/logs?channel=all`). The server merges and deduplicates entries from all three LoopTroop log channels server-side, appends OpenCode native log entries (parsed from logfmt and tagged `source: 'debug'`), sorts by timestamp, and returns a single list. Phase/status filters still apply to LoopTroop entries but OpenCode native entries are always included.
- Logged the previously-silent `part_removed` OpenCode SDK stream event to the debug channel, completing 100% SDK stream event coverage in logs.
- OpenCode managed server is now always started with `--log-level DEBUG`, writing native logs at full verbosity to the OpenCode log directory so they are always available in the DEBUG tab. Use `npm run dev --opencode-logs=all` to additionally print them to the terminal. The `--opencode-logs=all` flag adds `--print-logs` to the OpenCode serve args.

#### Fixed
- Fixed PRD coverage revision parsing so `change_type` aliases are recognized and path/summary-only change notes are dropped as diagnostics while the validated PRD diff remains reviewable.
- Fixed execution-setup and final-test attempt counters resetting to 1 after an app restart; both phases now resume from the correct attempt number derived from persisted retry notes, so the `maxIterations` guard is honoured across restarts.
- Fixed bead iteration countdown timer showing 00:00 on iteration 2+ beads; the timer now anchors to `updatedAt` (updated at the start of each iteration session) instead of `startedAt` (frozen at the first iteration), so the remaining time is accurate across all iterations.
- Fixed blocked CODING provider interruptions showing a live bead countdown while the ticket was paused; the header now hides the timer outside live CODING, and the error panel shows that the preserved session will resume with a fresh bead timer when Continue is available.
- Repaired opt-in structured YAML lists when a model emits an existing bead/PRD id or relevant-file path as a bare sequence item followed by object fields, with dynamic parser warnings that name the affected parent list, line, scalar value, and primary key.
- Hardened the WSL LAN sharing one-liner so it listens on detected Windows LAN addresses, clears stale wildcard `0.0.0.0` portproxy entries, starts the Windows IP Helper service, and forwards through Windows localhost into WSL instead of depending on a fragile current WSL NAT address.
- Let the ticket navigator's auto-expanded Errors section be collapsed and reopened by the user while preserving auto-open behavior for newly active or selected errors.
- Added guarded full-page recovery reloads after sustained backend reconnecting, live-update reconnecting, or post-initial ticket loading banners clear, with a 10-second session cooldown, a five-second minimum visible warning duration, and two 1.5-second backend health confirmation probes to avoid reload loops and transient false reconnect banners.
- Enriched generic `Provider returned error` OpenCode failures by correlating the session with local OpenCode logs, surfacing sanitized HTTP/provider details while excluding prompts, request bodies, headers, credentials, cookies, and URL query strings.
- Fixed Continue and owned-session reconnect checks to verify preserved OpenCode sessions by exact session ID instead of relying on session-list membership, and surfaced rejected workflow actions inline in the blocked-error view.
- Made `HTTP 402 Payment Required` OpenCode provider blocks eligible for same-session Continue after payment or workspace access is restored, while keeping permanent 4xx request, auth, permission, model-not-found, and request-size failures non-continuable.
- Fixed CODING timeout ownership so LoopTroop-owned per-iteration deadlines consume bead attempts, capture context-wipe notes, abandon the timed-out session, reset the worktree, and retry in a fresh owned session until `BEAD_RETRY_BUDGET_EXHAUSTED`, while true OpenCode/provider timeouts still preserve same-session Continue when eligible.
- Fixed Current Activity timeout detection so timeout-like strings in model/tool/debug output no longer create false `Workflow timeout` banners; near-timeout warnings now use structured prompt deadline metadata and only appear during the final warning window.
- Fixed stale Current Activity near-timeout warnings so completed prompts no longer keep showing active countdowns when revisiting a previous status, and terminal timeout elapsed values stay pinned to the diagnostic event.
- Made `npm run dev` print immediate and phase-level preflight progress before bootstrap dependency checks, daily dependency/audit/OpenCode maintenance, stale-process cleanup, and port checks, with a final completion duration.
- Updated ProfileSetup documentation-link test coverage for the OpenCode Max Steps configuration link and normalized `docs/roadmap.md` to LF-only line endings so release validation passes consistently.

---

## 0.2.2 (2026-05-22)

### Summary
- Extracted magic numbers into named constants, consolidated a repeated Tailwind label class, and standardised boolean variable naming across the codebase.
- Hardened workflow approval, audit, bead-finalization, archived-version, and cleanup boundaries with content hashes and visible cleanup warnings.
- Documented the ticket-handler route split from a single file into focused route modules without changing workflow behavior.
- Added profile-controlled OpenCode retry budgets so transient provider stalls block early with diagnostics and same-session Continue across OpenCode-backed phases.
- Preserved underlying OpenCode provider/session causes on coding bead failures so parser or retry-budget wrappers no longer hide usage-limit style blockers.
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
- Added a high-priority roadmap item for a Context Slimming Pipeline that audits per-phase input/output fields, strips unused data from canonical context while preserving it in companion artifacts, and classifies every field by downstream consumption.
- Applied targeted reliability and safety fixes from an external audit: atomic write durability, git timeout hardening, ticket cancel race, interview null guard, and bead schema validation.

### Detailed Changes

#### Changed
- Extracted 9 magic numbers (`GIT_CHECK_DEBOUNCE_MS`, `COUNTDOWN_TICK_MS`, `DROPDOWN_Z_INDEX`, etc.) into named constants in `src/lib/constants.ts`.
- Consolidated the repeated `text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground` Tailwind pattern (21 occurrences) into a `.section-label` `@apply` class in `src/index.css`.
- Standardised all boolean state and derived variables across 21 components to use `is`/`has`/`should` prefixes (e.g. `open` → `isOpen`, `showHistory` → `isHistoryOpen`, `showModelTabs` → `hasModelTabs`).

#### Added
- Added SHA-256 content identity to approval snapshots/receipts and artifact read responses, required `expectedContentSha256` approval payloads with stale-approval `409` responses, durable approval receipts for all approval gates, and append-only `user_edit_receipt:*` artifacts for manual artifact edits.
- Added `cleanup.status` to cleanup reports and a top-level ticket cleanup summary so completed tickets can surface non-blocking cleanup warnings.
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
- Clarified that the workspace phase header's `(details)` button opens the canonical workflow metadata from `shared/workflowMeta.ts`, and aligned the state-machine and ticket-flow wording for approval and execution-setup statuses with the current UI copy.
- Bead completion now means OpenCode success plus local finalization success: local commits are required when code changes exist, true no-op completions are allowed, push failures are warnings, and fatal finalization failures route through `BEAD_FINALIZATION_FAILED` instead of broadcasting `bead_complete`.
- Archived phase-attempt artifacts are explicitly read-only, while current approval-edit routes continue to write only the active version.
- Added "Context Slimming Pipeline" as a high-priority roadmap item in `docs/roadmap.md` for per-phase input/output field auditing, deterministic strip-and-store, and retry-path field classification.
- Updated architecture and ticket-flow documentation to reference the focused `server/routes/ticketHandlers/` module directory for user-triggered ticket actions.
- Clarified the Configuration UI copy for OpenCode Provider Recovery so it explicitly mentions rate-limit, usage-limit, overload, timeout, and network retry events across phases.
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
- Coding completion-marker and bead retry-budget failures now retain the latest underlying OpenCode provider/session diagnostic, such as usage-limit retries, in the blocked error details.
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

#### Security & Reliability
- Ticket cancel now awaits active OpenCode session abort before executing destructive cleanup, eliminating the race where cleanup could run while sessions were still writing.
- Interview batch async path now explicitly returns 404 when no session artifact is found, replacing the non-null assertion that could crash at runtime.
- Bead plan PUT endpoint now validates each bead against a required-field schema (id, title, status, priority, dependencies) and rejects duplicate IDs, preventing malformed execution plans from being written.
- Git operations now include a 30-second timeout and `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS=echo` environment guards so locked repositories, credential prompts, or network filesystems cannot hang the server process; push operations use a 120-second timeout.
- Atomic write helper now cleans up the `.tmp` file in all failure paths and fsyncs the parent directory after rename for crash-durable artifact persistence.

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
