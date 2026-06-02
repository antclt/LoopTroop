# OpenCode Integration

> [!IMPORTANT]
> **TL;DR** — OpenCode is LoopTroop's only interface to AI models. LoopTroop creates sessions, sends prompts, streams completions, and manages retries through OpenCode's API — it never calls model providers directly.

LoopTroop uses OpenCode as its model execution layer, but wraps it with its own session ownership, context assembly, event streaming, and workflow recovery logic.

## Core Modules

| Module | Responsibility |
| --- | --- |
| `server/opencode/adapter.ts` | Concrete OpenCode SDK adapter and interface |
| `server/opencode/factory.ts` | Singleton adapter creation and mock-mode switching |
| `server/opencode/sessionCreation.ts` | Bounded retry wrapper and health diagnostics for session creation |
| `server/opencode/sessionManager.ts` | Session ownership, reconnect, completion, abandonment |
| `server/opencode/contextBuilder.ts` | Phase-specific context assembly |
| `server/workflow/runOpenCodePrompt.ts` | Prompt orchestration and stream handling |

## Adapter Surface

The current `OpenCodeAdapter` interface exposes:

| Method | Purpose |
| --- | --- |
| `createSession()` | Create a new OpenCode session for a project path |
| `promptSession()` | Send prompt parts into an existing session |
| `getSession()` | Verify and read one remote session by exact id |
| `listSessions()` | Enumerate remote sessions |
| `getSessionMessages()` | Read session message history |
| `subscribeToEvents()` | Stream OpenCode events |
| `listPendingQuestions()` | Read pending human-input requests |
| `replyQuestion()` | Answer a pending request |
| `rejectQuestion()` | Reject a pending request |
| `abortSession()` | Abort a remote session |
| `assembleBeadContext()` | Build bead-context prompt parts |
| `assembleCouncilContext()` | Build council prompt parts |
| `checkHealth()` | Health and availability check |

Session creation, exact session lookup, session listing, and message reads accept `AbortSignal`s and are wrapped with bounded SDK-operation timeouts. Session creation also runs through a shared retry wrapper: after the initial failure, LoopTroop waits 1s, 3s, and 7s before the three retry attempts. Each failed create attempt collects lightweight OpenCode health diagnostics, but health is diagnostic-only and does not replace the actual session creation result.

## Base URL And Modes

| Setting | Meaning |
| --- | --- |
| `LOOPTROOP_OPENCODE_BASE_URL` | Base URL for the OpenCode server; defaults to `http://127.0.0.1:4096` |
| `LOOPTROOP_OPENCODE_MODE=mock` | Use the mock adapter instead of the SDK adapter |
| `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` | Do not override the OpenCode server permission mode during `npm run dev`; by default LoopTroop starts its managed OpenCode server with `OPENCODE_PERMISSION='"allow"'` |
| `LOOPTROOP_OPENCODE_LOGS=all` | Direct watcher fallback that starts managed OpenCode with `--print-logs --log-level DEBUG` when `npm run dev:opencode` actually launches the server |
| `LOOPTROOP_OPENCODE_LOG_DIR` | Optional OpenCode log directory used to enrich generic provider errors from an external or nonstandard OpenCode server |
| `OPENCODE_SERVER_USERNAME` | Basic auth username for requests to the local OpenCode server; defaults to `opencode` |
| `OPENCODE_SERVER_PASSWORD` | Basic auth password for requests to the local OpenCode server; `npm run dev` auto-generates an ephemeral credential if not set |

Both the LoopTroop backend and the OpenCode process must share the same credentials. `npm run dev` handles this automatically by propagating the generated credential to all child processes. To use a persistent credential, set `OPENCODE_SERVER_PASSWORD` (and optionally `OPENCODE_SERVER_USERNAME`) before running `npm run dev`.

When running `npm run dev`, the launcher probes the configured address first. If OpenCode is already responding there, it reuses that instance. If the default port is occupied by a non-OpenCode process, the launcher finds the next available port and starts OpenCode there instead.

## OpenCode Configuration Pass-Through

LoopTroop sends work through your OpenCode server rather than replacing its provider layer. Model Context Protocol tools, custom skills, permissions, and provider authentication configured in OpenCode remain available to LoopTroop sessions.

For full local OpenCode DEBUG logs in your terminal, run `npm run dev --opencode-logs=all`. The launcher maps that opt-in to OpenCode's documented [`--print-logs` and `--log-level DEBUG` CLI flags](https://opencode.ai/docs/cli/) for [`opencode serve`](https://opencode.ai/docs/server/) and propagates `LOOPTROOP_OPENCODE_LOGS=all` to the watcher. This only changes logging for an OpenCode server that LoopTroop starts itself; reused, remote, or mock servers keep their own logging configuration. OpenCode's [troubleshooting docs](https://opencode.ai/docs/troubleshooting/) describe DEBUG logs as detailed diagnostic output; treat them as sensitive local data because they may contain request or provider details.

When OpenCode emits only a generic `Provider returned error` stream event, LoopTroop best-effort scans the newest local OpenCode log files for the same `session.id` and surfaces the exact provider cause in the ticket log and blocked-error diagnostics. The enrichment keeps compact fields only: HTTP status, retryability, OpenCode provider/model, request model, provider error type/title/message, and a short response-body preview. It discards prompt bodies, raw request payloads, headers, cookies, authorization values, and URL query strings before persisting anything. By default it reads OpenCode's documented local log directory; set `LOOPTROOP_OPENCODE_LOG_DIR` when LoopTroop is attached to an external server with logs stored elsewhere.

For trusted local LoopTroop sessions, the managed OpenCode server is permissive by default: `scripts/dev-opencode.ts` sets `OPENCODE_PERMISSION='"allow"'` when it starts `opencode serve`, unless `LOOPTROOP_OPENCODE_PERMISSION_MODE=inherit` is set. LoopTroop also creates execution sessions with the SDK permission rule `{ permission: "*", pattern: "*", action: "allow" }`, so server-level permission policy and session-scoped permissions both allow required tool use. This removes OpenCode approval prompts from trusted automation, but it does not bypass normal OS privileges or make passworded `sudo` a dependency of setup.

## Session Ownership

LoopTroop does not treat OpenCode sessions as anonymous chat handles. It tracks who owns a session in the project database.

Current ownership dimensions can include:

```json
{
  "ticketId": "AUTH-12",
  "phase": "CODING",
  "phaseAttempt": 1,
  "memberId": null,
  "beadId": "api-refresh-endpoint",
  "iteration": 2,
  "step": null
}
```

This is what lets the backend distinguish:

- one council member's vote session from another
- the first execution attempt for a bead from the second
- a planning session from a coding session on the same ticket

## Prompt Runner

`runOpenCodePrompt()` is the main orchestration helper.

It currently does the following:

1. Resolve or create the session, retrying session creation failures before the prompt is sent.
2. If `sessionOwnership` is present, call `SessionManager.validateAndReconnect()` first.
3. Dispatch the prompt with tool policy and model settings.
4. Subscribe to stream events while the prompt is running.
5. Track OpenCode `session.status` retry events against the profile retry budget and grace window.
6. Reconcile the final response with assistant messages and stream status.
7. Mark the session completed or abandoned depending on the outcome.

`runOpenCodeSessionPrompt()` is the lower-level helper for prompting a known session.

Retry-status handling is driven by OpenCode stream events, not only by log text. The runner watches `session.status` retry events across OpenCode-backed phases and treats matching rate-limit, usage-limit, resource-exhaustion, overload/capacity, temporary-unavailability, timeout/deadline, fetch, network, and socket-reset messages as continuable provider interruptions. The profile's `OpenCode Retry Limit` blocks after a configured number of matching retry events, and `OpenCode Retry Grace Window` blocks when a matching retry state produces no progress for the configured window. A zero retry limit blocks on the first matching retry event; a zero grace window disables the timer.

When a ticket is blocked by a resumable OpenCode/provider interruption, the prompt runner can preserve the active owned session instead of abandoning it. Eligible interruptions include retryable diagnostics, HTTP 402/408/429/500/502/503/504/529, rate or usage limits, overload/capacity messages, timeouts, and transport failures. `HTTP 402 Payment Required` is treated as externally clearable, so Continue can resume the same session after payment or workspace access is restored. Auth, invalid request, request-size, permission, missing API key, model-not-found, and non-402 insufficient-quota signals remain non-continuable.

CODING also carries the latest meaningful OpenCode retry/session/output-limit diagnostic forward when a bead later blocks for completion-marker or bead retry-budget reasons, so the Error view can show the underlying provider/session cause alongside the bead wrapper failure.

The public Continue action records a pending continuation keyed by OpenCode `sessionId`. After the state machine returns from `BLOCKED_ERROR` to the failed phase, the next owned active-session prompt consumes that pending request and replaces only that prompt body with exactly:

```text
continue please
```

Continue does not archive the active phase attempt or create a fresh attempt. Retry still keeps the fresh-attempt behavior. For CODING provider interruptions, the blocked UI marks the bead as paused instead of showing a live iteration countdown; when Continue re-enters CODING, LoopTroop sends `continue please` to the preserved session with a fresh per-iteration timeout window.

## Reconnect Behavior

Reconnect is intentionally conservative.

`SessionManager.validateAndReconnect()` only succeeds when:

- the ticket still exists
- the ticket is still in the same phase
- the owned active session record still exists in the project DB
- the same session still exists remotely in OpenCode

If any of those checks fail, LoopTroop falls back to creating a fresh session through the same bounded session creation retry wrapper.

That means LoopTroop can survive restart and resume safely, but it does not try to magically continue any random broken stream from the past.

If OpenCode cannot verify an exact session because the server is down or restarting, validation fails closed without abandoning the database record. The prompt runner then either creates a new owned session when OpenCode is reachable or lets the phase fail into the normal retry/block path. Owned same-session reuse is also revalidated immediately before prompting, so a stale session cannot be prompted after the ticket has moved phases.

For Continue, the route performs one extra live check: if the OpenCode server can no longer read the preserved session by exact id, the request returns `409` and leaves the ticket in `BLOCKED_ERROR`.

## Streaming

OpenCode stream events are consumed server-side and then translated into LoopTroop's own ticket event model.

The SDK adapter subscribes to OpenCode's global event stream, unwraps `{ directory, payload }` frames, and filters them back to the owned session before emitting LoopTroop events. This keeps live model detail working when the directory-scoped OpenCode event endpoint closes early, while still preventing unrelated project/session events from entering the ticket log.

LoopTroop ships a project-level OpenCode plugin at `.opencode/plugins/looptroop-listener-limit.js` that raises the Node/Bun EventTarget listener warning threshold to 20 inside the OpenCode process. This only changes the warning threshold for legitimate parallel stream listeners; it does not create a hard concurrency limit or replace stream cleanup.

The prompt runner tracks:

- text events
- reasoning events
- tool events
- step start and finish events
- session status events, including retry budget/grace-window detection
- session error events

Step finish metadata is also used for blocked-error diagnostics. If OpenCode reports a finish reason such as `length`, LoopTroop records the failure as model output truncation, carries through token counts when available, and explains that subsequent structured-output validation errors may be secondary symptoms of an incomplete response.

The frontend never talks directly to OpenCode. It receives normalized ticket events over `/api/stream`.

AI detail rows are emitted as fast live-only upserts while a text or reasoning part is still changing, finalized when the part completes, and then written to `.ticket/runtime/execution-log.ai.jsonl`. After a prompt completes, the prompt runner also backfills finalized assistant message parts from `session.messages()` so thinking/tool/output history is durable even if no browser was watching the ticket in real time.

## Questions And Human Input

OpenCode may request user input during execution. LoopTroop exposes that queue through:

- `GET /api/tickets/:id/opencode/questions`
- `POST /api/tickets/:id/opencode/questions/:requestId/reply`
- `POST /api/tickets/:id/opencode/questions/:requestId/reject`

This lets the workflow remain durable even when the model pauses for an explicit decision.

## Health And Model Discovery

LoopTroop uses two related but different checks:

| Check | Purpose |
| --- | --- |
| `adapter.checkHealth()` | Basic OpenCode availability and version |
| `/api/models` | Provider catalog flattening and connected-model discovery |

If model discovery fails but health still passes, the API returns an empty model list plus a message instead of crashing the UI.

## Startup Recovery

On startup, LoopTroop:

- checks OpenCode health
- hydrates ticket actors from storage
- scans active session records in attached project databases
- attempts reconnect for owned sessions
- abandons stale session records that no longer exist remotely

This is why the OpenCode integration is part of the runtime architecture, not just a transport detail.

Startup session recovery is best effort. If OpenCode itself is unavailable, ticket actors are still hydrated from durable workflow state, and later phase work will either reconnect, create a fresh owned session, or block with a persisted error according to the phase's recovery rules.

## Why LoopTroop Wraps OpenCode This Heavily

OpenCode is the model execution engine. LoopTroop adds:

- phase-aware context assembly
- ticket-aware session ownership
- durable restart behavior
- workflow-aware retries
- frontend-ready event projection

Without that wrapper, the rest of the system would have no safe way to restart, audit, or recover a long-running ticket lifecycle.

## Related Docs

- [Context Engineering](context-engineering.md)
- [Beads & Execution](beads.md)
- [API Reference](api-reference.md)
- [System Architecture](system-architecture.md)
