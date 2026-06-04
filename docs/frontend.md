# Frontend

> [!IMPORTANT]
> **TL;DR** — The frontend is a local React + TypeScript SPA using Vite, Zustand, and SSE for real-time updates. It renders ticket workflow, approval gates, coding progress, bead grids, artifact inspection, and phase-versioned history.

The frontend is a React 19 SPA that renders the ticket dashboard, the live workspace, review panes, and the navigator surfaces around them.

The UI is data-driven from:

- `/api/*` REST endpoints
- `/api/stream` SSE updates
- workflow metadata in `shared/workflowMeta.ts`
- ticket artifacts and runtime state from the backend

In development, same-origin `/api/*` calls go through the Vite proxy. When `npm run dev` generates or receives `LOOPTROOP_API_TOKEN`, the proxy supplies the token to the backend server-side so the browser bundle does not contain the secret.

The app shell also polls `/api/health` for the global reconnecting banner. After the backend has been reached once, a failed health probe is confirmed by two more probes spaced 1.5 seconds apart before the banner appears. When reconnecting or post-initial loading banners remain visible for at least five seconds and then clear, the frontend schedules one guarded full-page reload, throttled by `sessionStorage` for 10 seconds, so real backend gaps recover the same way as a manual refresh without turning brief warning flickers into page reloads.

## 1. Top-Level Composition

| Area | Purpose | Primary files |
| --- | --- | --- |
| App shell | App startup, configuration preload, global layout | `src/App.tsx` |
| Ticket dashboard | Ticket list, status cards, workspace selection | `src/components/ticket/*` |
| Active workspace | Chooses the live view for the selected phase | `src/components/ticket/ActiveWorkspace.tsx` |
| Navigator | Timeline, approval navigation, context tree, errors, full log entry point | `src/components/ticket/NavigatorPanel.tsx` |
| Workspace views | Draft, council, interview, approval, coding, error, canceled, review, full log | `src/components/workspace/*` |

## 2. Active Workspace Routing

`ActiveWorkspace.tsx` maps workflow metadata to concrete views.

| `uiView` | Current component |
| --- | --- |
| `draft` | `DraftView` |
| `council` | `CouncilView` |
| `interview_qa` | `InterviewQAView` |
| `approval` | `ApprovalView` |
| `coding` | `CodingView` |
| `error` | `ErrorView` |
| `done` | `CodingView` |
| `canceled` | `CanceledView` |

Additional routing rules:

- historical phases usually render through `PhaseReviewView`
- `fullLogOpen` forces `FullLogView` until the user selects another phase or error occurrence
- reviewable past coding still uses `CodingView` in read-only mode
- active or selected error occurrences render `ErrorView`

## 3. Navigator Surfaces

`NavigatorPanel.tsx` is more than a left rail. It combines several different navigation modes:

- `PhaseTimeline` for the workflow spine
- `ErrorOccurrencesPanel` for active and past failures; active or selected errors auto-expand as a starting state but remain user-collapsible, its compact header shows only count/state, and expanded coding-error rows use the ticket's runtime bead counters while leaving deeper bead/error details to the workspace view
- `ApprovalNavigator` for interview, PRD, and beads approval context
- `ContextTree` for context visibility
- a full-log toggle that opens `FullLogView`
- error occurrence selection exits full-log mode and opens `ErrorView` for the selected failure

That split matters because the workspace is designed for both live work and historical review.

## 4. Key Workspace Views

| View | Primary purpose |
| --- | --- |
| `DraftView` | Ticket editing and start controls |
| `CouncilView` | Multi-model draft and vote phases with artifacts |
| `InterviewQAView` | Interactive interview batches, draft persistence, skip flow |
| `ApprovalView` | Review and edit interview, PRD, beads, and execution setup artifacts; PRD approval also exposes the winning model's Full Answers as compact read-only context, and execution setup approval keeps live logs expanded until the setup plan is ready |
| `CodingView` | Active bead execution, bead list, logs, diffs, verification actions |
| `ErrorView` | Live blocked state or historical error occurrence review |
| `PhaseReviewView` | Historical artifact review for completed phases |
| `FullLogView` | Full folded execution log stream |

## 5. Coding Workspace Surfaces

The coding workspace is broader than a simple log pane.

Current `CodingView` composes:

- bead list and progress UI
- `BeadDiffViewer`
- `CollapsiblePhaseLogSection`
- `LogEntryRow`
- `PhaseArtifactsPanel`
- `VerificationSummaryPanel`

It also merges persisted bead artifacts with runtime bead overlays from the live ticket payload so the UI can show in-progress status and notes without waiting for a full artifact refresh.

## 6. Data Hooks

### Workflow And Artifacts

| Hook | Current role | Current return shape |
| --- | --- | --- |
| `useWorkflowMeta()` | Loads phase and group metadata | `{ groups, phases, phaseMap, isLoading }` |
| `useTicketArtifacts(ticketId, opts?)` | Fetches and caches ticket artifacts | `{ artifacts, isLoading }` |
| `useTicketPhaseAttempts(ticketId?, phase?)` | Reads phase-attempt history | React Query result |
| `useCoverageHooks` (various) | Provides coverage status and override actions for PRD and Beads coverage phases | React Query result |

### Ticket And Profile Data

| Hook | Current role |
| --- | --- |
| `useTickets(projectId?)` | Ticket list with auto-refresh for active tickets |
| `useTicket(id)` | Individual ticket with active-state refresh |
| `useProfile()` | Singleton profile query against `/api/profile` |
| `useOpenCodeModels()` | Connected models only |
| `useAllOpenCodeModels()` | Full catalog including disconnected providers |

### Live Updates

`useSSE({ ticketId, onEvent })` is the ticket stream hook.

Current behavior:

- connects to `/api/stream`
- persists the latest SSE event id per ticket in browser storage
- sends `ticketId` and `lastEventId` on reconnect when available
- uses the same-origin Vite proxy during development, which injects token auth server-side; outside that path, `apiToken` query auth is only valid for `/api/stream`
- listens for `state_change`, `progress`, `log`, `error`, `bead_complete`, `needs_input`, and `artifact_change`
- receives AI/model log detail as fast live-only `log` upserts plus persisted finalizations/backfills backed by `.ticket/runtime/execution-log.ai.jsonl`, so OpenCode thinking, tool calls, and model output can appear live without bloating durable logs and remain available after reconnect or tab close
- invalidates or patches React Query caches in response
- refetches ticket details, ticket lists, artifacts, interview state, setup-plan state, bead state, and server logs after a reconnect gap
- lets the dashboard trigger the guarded recovery reload once the visible live-update reconnecting episode has cleared
- returns `{ lastEventIdRef, connectionState }`

Current `connectionState` values are:

- `connecting`
- `connected`
- `reconnecting`

## 7. Interview Draft Persistence

`useBatchSubmit(ticketId)` is one of the higher-value stateful hooks in the app.

It does more than submit answers:

- stores draft answers per interview batch
- tracks skipped questions
- tracks selected options
- restores drafts from persisted UI state
- auto-saves drafts with debounce through ticket UI-state artifacts and only marks a draft saved after the write succeeds
- flushes the latest unsaved snapshot with a keepalive request on `pagehide` or `beforeunload`
- coordinates submit and skip mutations
- listens for interview batch updates coming back from the runtime

That makes `InterviewQAView` resilient across reloads, view changes, and follow-up question rounds.

### Coverage & Flow Controls

The workflow is guided by specialized control components:
- `InterviewFlowControls.tsx`: Provides the primary interaction surface for answering or skipping batches of questions.
- `InterviewFollowUpControls.tsx`: Manages the UI state during dynamic follow-up rounds when the coverage loop requires more information.
- `PrdCoverageControl.tsx` and `BeadsCoverageControl.tsx`: Handles manual verification overrides and review presentation during the PRD and Beads coverage phases.
- `OpenCodeAuthAlert.tsx`: Surfaces OpenCode connection or authentication issues gracefully before prompting fails.

Approval panes use the same success-aware debounced UI-state pattern for editor drafts. This protects large manual edits if the browser tab closes before the debounce timer finishes.

`PrdApprovalPane` keeps the PRD editor as the primary surface. When the winning PRD draft has a Part 1 Full Answers artifact, the header shows a compact `Full Answers` chip that opens the read-only complete interview answer set used by that winning draft.

## 8. Artifact And Review Surfaces

Several UI components exist specifically to inspect durable workflow state:

| Component | Purpose |
| --- | --- |
| `PhaseArtifactsPanel` | Phase-specific artifact viewer |
| `PrdApprovalPane` | PRD approval editor plus compact read-only Full Answers context for the winning draft |
| `WorkspacePhaseSummary` | Compact summary for the selected phase; its `(details)` button opens the expanded workflow metadata from `shared/workflowMeta.ts` while keeping the selected status lightweight above the workspace |
| `VerificationSummaryPanel` | Delivery actions during PR review |
| `PhaseReviewView` | Historical artifact review with phase-attempt support |
| `FullLogView` | Ticket-wide log inspection |

The frontend is built around the assumption that users must be able to inspect prior attempts and artifacts without replaying the run mentally from logs.

`WorkspacePhaseSummary` enriches only the live status title with transient progress details. While a ticket is actively implementing, it shows bead and iteration wording such as `Implementing (working on bead 3 of 10, iteration 2 of 5)`. While coverage is active, it shows pass details and, for PRD/Beads coverage, the candidate version being checked. Manual non-implementation retries show the active phase attempt, for example `Refining Specs (retry attempt 2)`. These additions disappear as soon as the ticket transitions away from that status, so historical review and past timeline rows return to the plain phase label.

Council-style live workspace phases keep their current-action card dense: compact heading text, tight paragraph leading, and minimal header/content padding so artifacts and logs remain visible without scrolling past oversized status chrome.

`LogProvider` treats the server-side normal execution log as durable truth for the lifecycle view. SSE-delivered rows merge into the in-memory log state immediately so the phase log viewer and full log can render live updates without waiting for file persistence. The browser opens the ticket stream through the same-origin `/api/stream` route, matching normal API fetches and avoiding dev-environment host/CORS drift. In dev, that same-origin path lets Vite inject backend auth without exposing the token to client code; direct stream clients may use `apiToken` only on `/api/stream` when they cannot send headers. Browser-local logs are a best-effort responsiveness cache, but reconnect recovery requests the complete matching server log again and merges by stable entry identity so a frontend restart does not leave the visible log pane stale.

The Current Activity strip above phase and full log views is intentionally diagnostic-only after the first model activity. It shows waiting-for-first-activity and provider retry states before output starts, terminal timeout/empty-output diagnostics from trusted LoopTroop/OpenCode status rows, and an `Approaching timeout` warning only when prompt deadline metadata says the configured timeout is close and the prompt has not yet emitted model activity or completion. Model text, tool output, debug raw messages, and repository source snippets are never scanned for generic timeout words, so target-code symbols such as `ErrTimeout` or `fsWatcherTimeoutS` cannot produce a false workflow timeout banner.

Internal command rows in `SYS > CMD` are result-only summaries. LoopTroop records the command after it completes, prefers concise semantic outcomes for quiet internal commands (for example, clean worktree, push completed, or no files removed), and avoids recurring progress-style command output in deterministic git/GitHub operations.

Streaming AI upserts are also written to `.ticket/runtime/execution-log.ai.jsonl`, a separate AI detail channel that is loaded lazily only for AI and model log views. The backend still does not append those intermediate snapshots to `execution-log.jsonl`; finalized AI rows remain in the normal log for lifecycle history, while the AI detail log preserves prompts, thinking, tool calls, session rows, and latest streaming snapshots for reopening a ticket. After each OpenCode prompt completes, LoopTroop also backfills finalized thinking/tool/step rows from every assistant message in the completed prompt segment of the SDK `session.messages()` parts snapshot, so durable AI detail captures multi-message tool-use turns and does not depend on whether the browser was watching the phase live or whether the event stream stayed connected for the whole response. Loading that detail channel must not broaden `SYS`, `ERROR`, or `CMD` filters; those tabs classify entries from structured source/audience/kind fields and leading runtime tags, not tag-like strings inside raw model output.

The `DEBUG` tab provides a complete view of every log line for the ticket. It loads `channel=all` on demand, which merges all three LoopTroop log files (`execution-log.jsonl`, `execution-log.debug.jsonl`, `execution-log.ai.jsonl`) plus OpenCode native server log lines filtered by the ticket's session IDs. All OpenCode SDK stream event types — including `part_removed` — are logged to the debug channel. OpenCode native logs are always written at `--log-level DEBUG` (the managed server is always started with this flag), so they are always available for the DEBUG tab without any extra configuration. Use `npm run dev --opencode-logs=all` to also print them to the terminal. Other tabs (`ALL`, `SYS`, `AI`, `ERROR`) are unaffected — they classify entries from structured `source`, `audience`, and `kind` fields regardless of which channel loaded them.

Artifact raw tabs show line, character, and tokenizer counts. Coverage report cards intentionally omit line-count details because JSON envelopes and escaped multiline payloads can make a displayed card total misleading. Coverage result summaries show status, gap counts, termination/budget notes, open coverage gaps, and interview follow-up questions; the underlying model output and retry attempts remain available in Raw. Versioned coverage reports list transition tabs in version order, keep `Latest Check` last but selected by default, and suppress open-gap lists when the latest candidate has no remaining gaps; transition tabs still show the gaps found in that specific earlier version.

Structured artifacts that include `rawAttempts` expose those attempts as Raw variants. Single-model attempt views group the attempts under a passive source label that includes the model when known and the mode/substep, then show only concrete attempt buttons in numeric order, such as `Attempt 1 Output - Rejected` followed by `Attempt 2 Output - Accepted`; they do not add a separate stored artifact JSON shortcut. Future attempts may also include an `Initial Prompt` variant before the attempt buttons when the original model prompt was persisted; this shows only the first prompt sent for that model run, never retry prompts or inferred legacy log content. Normalized validated draft/vote selectors include the accepted retry number when known, such as `Attempt 2 Validated`, while preserving the surrounding attempt order. Log-derived rejected retry shortcuts also use the inferred rejected attempt number, such as `Attempt 1 Output - Rejected`, when raw attempt records are unavailable. Diagnostic attempts without model text show the captured error/failure class instead of fabricated raw content. Grouped Raw selectors show model names as passive labels and keep only concrete variants clickable, so model labels do not duplicate an attempt tab. When two variants render the same payload, the viewer shows it once and prefers the more specific retry/validated attempt tab over generic shortcuts such as `Raw Output`, `Model Output`, `Accepted Output`, `Validated`, or `Rejected`; `Initial Prompt` is kept separate even if its text matches another variant. Parser/retry intervention notices stay on the primary artifact tab rather than Raw/Diff diagnostics, and full malformed model text remains confined to Raw output panes and execution logs. Council draft/vote artifacts can still fall back to existing phase model-output logs scoped by phase, model, and PRD sub-stage where needed. Draft raw-log fallback is limited to draft-producing phases; voting-phase winner artifacts never use vote scorecard logs as draft Raw output, so both Raw and validated winner views stay scoped to the selected draft. After a drafting phase, previous draft artifacts shown in voting/refining views expose only the validated draft in Raw, matching the canonical content consumed downstream.

Council drafts with `invalid_output`, `failed`, or `timed_out` outcomes are diagnostic-only in the structured tab. The viewer suppresses draft body rendering even when older companion artifacts still contain a body for that member, and vote/refine merged views strip those failed draft bodies before display. Raw model output, raw attempts, validation errors, and retry excerpts remain available from diagnostics and the Raw tab only while inspecting the drafting phase that produced them; later previous-draft views stay validated-only.

Failed execution setup plan and runtime reports keep `modelOutput` out of the structured details/body. When available, that model output and any `rawAttempts` are exposed through Raw tab variants so failure diagnostics remain inspectable without presenting rejected setup text as accepted plan content.

Manual Retry from `BLOCKED_ERROR` is represented as a phase version for every non-implementation status, not another Raw variant. Views that load archived phase attempts use the existing previous-version selector and `phaseAttempt`-scoped artifact/log queries, including non-`CODING` runtime/delivery phases shown through `CodingView`; error occurrence history remains the source for the blocked-error timeline. Active selected attempts use the live `LogContext`/SSE stream with a `phaseAttempt` filter, while archived selected attempts use a static `/api/files/:ticketId/logs?phaseAttempt=N` snapshot and do not merge live rows. `CODING` keeps its bead-scoped retry UI instead of phase versions.

When a bead is selected in `CodingView`, the bead panel exposes `Details`, `Changes`, `Log`, `Input`, and `Output` tabs with tooltips on each tab. `Input` shows the raw initial prompt captured for the selected bead iteration, using the same readable raw formatting, line count, character count, GPT-5 tokenizer count, and compact copy button as artifact Raw panes. `Output` shows the final model response for that bead iteration, or a captured diagnostic when no model text was available; it stays disabled until the selected iteration has a terminal output or diagnostic. If multiple bead iterations exist, a `Versions` selector appears below the tab bar, sorted by iteration number and labelled by outcome so failed, timed-out, rejected, and accepted attempts remain inspectable without mixing inner same-session retry prompts into the history.

### Artifact Processing Notices

Future artifact companion payloads should persist parser and normalizer intervention details in `structuredOutput.interventions`. The collapsed notice stays compact and may include cheap category or rule labels, while the expanded notice treats `interventions` as the display source of truth for exact corrections, before/after examples, rule, category, stage, target, raw validator/parser messages, validation errors, and retry diagnostics. Retry notices summarize counts, failure classes, validation errors, and short excerpts; they do not duplicate full rejected responses from Raw attempts.

`structuredOutput.repairWarnings` remains a raw audit string list and can be shown as source messages. When a legacy `.ticket/**` artifact has recognized warning strings but no explicit interventions, the frontend derives best-effort notice categories at render time without rewriting or migrating the artifact. Generic legacy repair strings stay quiet unless a structured intervention or retry diagnostic is present.

Parser repairs and structured retries are artifact processing notices, not coverage warnings. Coverage warnings should stay reserved for unresolved planning gaps, including unresolved contradictions inside the source artifacts when a prompt reports them.

Voting artifacts keep one collapsed aggregate processing notice so scorecard repairs remain visible at the top of the results. Expanding that notice shows the full intervention details grouped by affected voter model only; the normal **Voter Details** scorecard section does not repeat the same notices.

## 9. Frontend-State Relationship To Workflow Metadata

The frontend does not hardcode the full workflow. Instead, it derives major behavior from `shared/workflowMeta.ts`:

- group ordering for the timeline
- phase labels
- `uiView` mapping
- whether a phase exposes a review artifact type
- whether a phase is editable
- whether multi-model logs are expected
- whether a phase has question or bead progress semantics

The current timeline group order is To Do, Discovery, Interview, Specs (PRD), Blueprint (Beads), Pre-Implementation, Implementation, Post-Implementation, Done, and Errors. `PhaseTimeline` hides empty groups, so Errors only appears when the blocked-error phase is visible.

This is why keeping the docs aligned with `workflowMeta` matters: the UI is built around that shared metadata contract.

## 10. Configuration And Settings UI

`ProfileSetup` (`src/components/config/ProfileSetup.tsx`) is the main configuration form. It is opened from the app header and lets you set all model and workflow defaults.

### Model Selection

| Field | Purpose |
| --- | --- |
| Main Implementer | The primary model used for coding phases. Shown with an optional `EffortPicker` when the model exposes variants. |
| Council Members | Additional models that participate in planning drafts and voting. The main implementer is always added to the council automatically and cannot appear twice. |

`ModelPicker` (`src/components/config/ModelPicker.tsx`) is the shared dropdown for selecting models from the live OpenCode catalog. It filters to connected models only by default.

`EffortPicker` (`src/components/config/EffortPicker.tsx`) appears next to a model selector when that model exposes variants (for example `high`, `low`, `medium`). The selected variant is stored per model id in `councilMemberVariants`.

### Numeric Settings

All numeric fields are validated against min/max bounds defined in `numericFieldConfig.ts`. Each field links to the relevant docs section:

| Field | Docs link |
| --- | --- |
| Per-Iteration Timeout | [Beads & Execution](beads.md#per-iteration-timeout) |
| Execution Setup Timeout | [Beads & Execution](beads.md#execution-setup-timeout) |
| AI Response Timeout | [LLM Council](llm-council.md#ai-response-timeout) |
| Max Bead Retries | [Beads & Execution](beads.md#max-bead-retries) |
| OpenCode Retry Limit | [Configuration Reference](configuration.md#opencode-retry-limit) |
| OpenCode Retry Grace Window | [Configuration Reference](configuration.md#opencode-retry-grace-window) |
| Min Council Quorum | [LLM Council](llm-council.md#min-council-quorum) |
| Max Interview Questions | [Ticket Flow](ticket-flow.md#max-interview-questions) |
| Structured Output Retries | [Configuration Reference](configuration.md#structured-output-retries) |
| Coverage Follow-Up Budget | [Ticket Flow](ticket-flow.md#coverage-follow-up-budget) |
| Interview Coverage Passes | [Ticket Flow](ticket-flow.md#interview-coverage-passes) |
| PRD Coverage Passes | [Ticket Flow](ticket-flow.md#prd-coverage-passes) |
| Beads Coverage Passes | [Ticket Flow](ticket-flow.md#beads-coverage-passes) |
| Tool Input Max Chars | [Beads & Execution](beads.md#tool-log-truncation) |
| Tool Output Max Chars | [Beads & Execution](beads.md#tool-log-truncation) |
| Tool Error Max Chars | [Beads & Execution](beads.md#tool-log-truncation) |

> [!NOTE]
> Timeout and delay fields are stored in **milliseconds**. `ProfileSetup` converts those stored milliseconds to seconds for display and back to milliseconds on save.

Profile settings are inherited by new tickets at start time. The locked copies in the ticket record are what the workflow actually uses for that run.

## 11. Context Providers

Three React context providers wrap the ticket workspace and wire up cross-cutting concerns:

| Provider | Location | Purpose |
| --- | --- | --- |
| `LogProvider` | `LogContext.tsx` | Owns the in-memory execution log for the active ticket. Merges SSE-delivered log rows immediately and handles reconnect recovery by re-requesting the server log and merging by stable entry identity. |
| `UIProvider` | `UIContext.tsx` | Manages workspace UI state: selected phase, open panels, mobile nav visibility, and the full-log toggle. |
| `AIQuestionProvider` | `AIQuestionContext.tsx` | Manages the queue of pending AI question batches for the active interview. Drives `InterviewQAView` without requiring prop drilling. |

These providers are composed in `TicketDashboard` around `ActiveWorkspace` and the navigator surfaces.

## 12. Kanban Board

`KanbanBoard` (`src/components/kanban/KanbanBoard.tsx`) is the alternate ticket overview. It groups `TicketCard` components into four fixed board locations: To Do, Needs Input, In Progress, and Done.

Ticket placement comes from the `kanbanPhase` mapping in `workflowMeta.ts`/`STATUS_TO_PHASE`. To Do is for created-but-not-started tickets, Needs Input is for any user-owned pause including blocked errors, In Progress is for active AI or system workflow work, and Done is for completed or canceled terminal tickets. `KanbanColumn` handles the per-column layout and empty-column suppression.

Press `k` anywhere outside a text input to navigate to the Kanban board.

## 13. Keyboard Shortcuts

`KeyboardShortcuts` (`src/components/shared/KeyboardShortcuts.tsx`) registers a global `?` handler and renders a centered overlay when triggered.

| Key | Action |
| --- | --- |
| `?` | Toggle the keyboard shortcuts overlay |
| `Escape` | Close current view or modal |
| `n` | Create a new ticket |
| `k` | Navigate to the Kanban board |
| `/` | Focus the search input |

Shortcuts are suppressed when focus is inside an `<input>` or `<textarea>`.

## 14. Ticket Cancel Confirmation Dialog

The cancel button in `DashboardHeader` is labeled **"Cancel…"** (the ellipsis signals that a dialog will open before any action is taken).

Clicking the button opens a confirmation dialog with two optional, unchecked-by-default cleanup checkboxes:

| Checkbox | Effect when checked |
| --- | --- |
| **Delete AI-generated artifacts and worktree** | Permanently removes interview Q&A, PRD drafts, and beads plan entries from the database, and deletes the isolated git worktree (including its branch and any code written to it) |
| **Delete execution log** | Permanently removes `.ticket/runtime/execution-log.jsonl`, `.ticket/runtime/execution-log.debug.jsonl`, and `.ticket/runtime/execution-log.ai.jsonl` for this ticket; effective only when the worktree still exists (worktree removal via the first checkbox already covers these logs) |

Both options default to unchecked — canceling without checking anything preserves all artifacts exactly as the basic cancel behavior did before.

The dialog calls `useCancelTicket` which POSTs `{ deleteContent, deleteLog }` to `POST /api/tickets/:id/cancel`. The hook invalidates the ticket and ticket-list queries on success.

## Related Docs

- [API Reference](api-reference.md)
- [Ticket Flow & State Machine](ticket-flow.md)
- [OpenCode Integration](opencode-integration.md)
- [System Architecture](system-architecture.md)
