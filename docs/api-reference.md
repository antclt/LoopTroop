# API Reference

All backend routes are mounted under `/api`.

This page documents the current HTTP surface exposed by `server/index.ts` and the route handlers in `server/routes/*`.

## Conventions

| Convention | Meaning |
| --- | --- |
| Ticket identifiers | Most ticket endpoints use the external ticket reference, not the local numeric DB id |
| JSON validation | Most write routes validate request bodies with Zod or route-specific parsers |
| Streaming | Live ticket updates use Server-Sent Events from `/api/stream` |
| Error shape | Error responses usually include `error` and sometimes `details` or `message` |
| Content hashes | Human-reviewed artifacts expose lowercase SHA-256 hashes so approval requests can prove which bytes were reviewed |

When `LOOPTROOP_API_TOKEN` is configured, every `/api/*` route requires either `X-LoopTroop-Token: <token>` or `Authorization: Bearer <token>`. The only query-token exception is `/api/stream`, where browser `EventSource` clients may use `apiToken=<token>` because they cannot set custom headers. `npm run dev` generates an ephemeral token when needed and keeps it server-side; the Vite dev proxy injects it for same-origin `/api` requests.

All `/api/*` routes share a global per-client rate limit, with separate buckets for read requests, normal write actions, and UI-state autosave writes. The default local-tool budget is 200 reads/minute, 120 normal writes/minute, and 300 autosaves/minute per client. When a limit is exceeded, the backend returns `429` with a JSON error body and a `Retry-After` header containing the number of seconds to wait before retrying.

## Health, Models, Workflow Meta, And Streaming

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Basic process health |
| `GET` | `/api/health/opencode` | OpenCode reachability and version |
| `GET` | `/api/health/startup` | Startup recovery and restore status |
| `POST` | `/api/health/startup/restore-notice/dismiss` | Dismiss startup restore notice |
| `GET` | `/api/models` | Connected and full model catalog |
| `GET` | `/api/workflow/meta` | Current workflow groups and phases |
| `GET` | `/api/stream?ticketId=<id>` | Ticket-scoped SSE stream; validates the ticket and enforces stream caps |

`/api/stream` also accepts `lastEventId` and, when header auth is not available, `apiToken` query parameters. Browsers normally send `Last-Event-ID` automatically only for native reconnects; the frontend persists the last event id per ticket and sends the query value after reloads so the backend can replay buffered events when possible.

Example health payload:

```json
{
  "status": "ok",
  "timestamp": "2026-04-23T09:00:00.000Z",
  "uptime": 1234.56
}
```

Example models payload:

```json
{
  "models": [],
  "allModels": [],
  "connectedProviders": [],
  "defaultModels": {},
  "message": "OpenCode server is not reachable. Start it with `opencode serve`."
}
```

## Profile Routes

LoopTroop uses a singleton profile, not a collection.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/profile` | Returns the singleton profile or `null` |
| `POST` | `/api/profile` | Creates the singleton profile |
| `PATCH` | `/api/profile` | Updates the singleton profile |

Example profile update payload:

> [!NOTE]
> Timeout and delay fields (`perIterationTimeout`, `executionSetupTimeout`, `councilResponseTimeout`, `opencodeRetryDelay`) are stored and used in **milliseconds**. The values shown below are the current defaults.

```json
{
  "mainImplementer": "openai/gpt-5.4",
  "mainImplementerVariant": "high",
  "councilMembers": "[\"openai/gpt-5.4\",\"anthropic/claude-sonnet-4\"]",
  "councilMemberVariants": "{\"openai/gpt-5.4\": \"high\"}",
  "minCouncilQuorum": 2,
  "perIterationTimeout": 1200000,
  "executionSetupTimeout": 1200000,
  "councilResponseTimeout": 1200000,
  "interviewQuestions": 50,
  "coverageFollowUpBudgetPercent": 20,
  "maxCoveragePasses": 2,
  "maxPrdCoveragePasses": 5,
  "maxBeadsCoveragePasses": 5,
  "structuredRetryCount": 1,
  "maxIterations": 5,
  "opencodeRetryLimit": 10,
  "opencodeRetryDelay": 60000,
  "toolInputMaxChars": 4000,
  "toolOutputMaxChars": 12000,
  "toolErrorMaxChars": 6000
}
```

`councilMemberVariants` is a JSON-encoded map of model ID → variant string (e.g. `"high"` or `"low"`) that pins specific effort levels per council member.

`structuredRetryCount` controls automatic structured-output retry prompts after the first invalid or missing structured response. It defaults to `1`, accepts `0` through `5`, and is locked onto each ticket at start; missing locked values on older tickets fall back to the current profile value and then the default.

`opencodeRetryLimit` and `opencodeRetryDelay` control prompt-level OpenCode retry handling for continuable provider interruptions across all phases that use OpenCode. The limit defaults to `10` retry status events and accepts `0` through `50`; the delay defaults to `60000` ms and accepts `0` through `3600000`. Exhaustion of either budget blocks with diagnostics and preserves the active session for Continue when the interruption is resumable.

## Project Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/projects/check-git?path=...` | Validates git and GitHub origin status for a folder |
| `GET` | `/api/projects/ls?path=...` | Directory browser used by the attach-project flow |
| `GET` | `/api/projects` | List attached projects |
| `GET` | `/api/projects/:id` | Get one project |
| `POST` | `/api/projects` | Attach a project |
| `PATCH` | `/api/projects/:id` | Update project settings |
| `DELETE` | `/api/projects/:id` | Delete a project if no active tickets remain |
| `GET` | `/api/projects/:id/worktrees/size` | Get the total disk size of all worktrees for a project |
| `DELETE` | `/api/projects/:id/worktrees` | Delete worktrees for completed and canceled tickets only; active ticket worktrees are left untouched |

Example project attachment payload:

```json
{
  "name": "LoopTroop",
  "shortname": "LOOP",
  "folderPath": "/home/liviu/LoopTroop",
  "icon": "📁",
  "color": "#3b82f6",
  "profileId": 1
}
```

Worktree size response:

```json
{ "bytes": 1234567 }
```

Worktree delete response:

```json
{ "success": true, "freedBytes": 1234567 }
```

Project deletion (`DELETE /api/projects/:id`) returns 409 when any ticket in the project is not in `DRAFT`, `COMPLETED`, or `CANCELED` status. Finish or cancel all active tickets before deleting the project. Worktree deletion is narrower: it only removes completed and canceled ticket worktrees and leaves active ticket worktrees untouched.

## Ticket Routes

### CRUD And UI State

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets` | Optionally filtered with `?projectId=` |
| `GET` | `/api/tickets/:id` | Get one ticket |
| `POST` | `/api/tickets` | Create a ticket; title max 500 characters and description max 10,000 characters |
| `PATCH` | `/api/tickets/:id` | Update title, description, or priority |
| `DELETE` | `/api/tickets/:id` | Only allowed for `COMPLETED` or `CANCELED` |
| `GET` | `/api/tickets/:id/ui-state?scope=...` | Read persisted UI state |
| `PUT` | `/api/tickets/:id/ui-state` | Save persisted UI state |

Example ticket creation payload:

```json
{
  "projectId": 1,
  "title": "Implement refresh-token rotation",
  "description": "Rotate refresh tokens and invalidate the family on reuse.",
  "priority": 2
}
```

Create-ticket validation requires a non-empty title up to 500 characters. The optional description is capped at 10,000 characters.

Example UI-state payload:

```json
{
  "scope": "interview-drafts",
  "clientRevision": 12,
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  }
}
```

Example UI-state response:

```json
{
  "scope": "interview-drafts",
  "exists": true,
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  },
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "clientRevision": 12
}
```

`clientRevision` is optional for direct callers but recommended. When present, stale lower revisions are ignored so delayed autosaves cannot overwrite newer UI state.

### Workflow Actions

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/tickets/:id/start` | Starts a `DRAFT` ticket using locked profile and project settings |
| `POST` | `/api/tickets/:id/approve` | Generic workflow approval endpoint |
| `POST` | `/api/tickets/:id/cancel` | Cancel active work — accepts an optional JSON body (see below) |
| `POST` | `/api/tickets/:id/approve-interview` | Approve interview artifact |
| `POST` | `/api/tickets/:id/approve-prd` | Approve PRD artifact |
| `POST` | `/api/tickets/:id/approve-beads` | Approve bead plan artifact |
| `POST` | `/api/tickets/:id/approve-execution-setup-plan` | Approve execution setup plan |
| `POST` | `/api/tickets/:id/merge` | Merge delivered PR |
| `POST` | `/api/tickets/:id/close-unmerged` | Close without merge |
| `POST` | `/api/tickets/:id/verify` | Alias for the merge handler — both routes call the same handler |
| `POST` | `/api/tickets/:id/retry` | Retry a blocked ticket or failed phase; versions every non-implementation failed phase and keeps CODING on bead-scoped reset recovery |
| `POST` | `/api/tickets/:id/continue` | Continue a blocked ticket only when eligible OpenCode/provider diagnostics, including `HTTP 402 Payment Required`, have a matching active preserved OpenCode session |
| `POST` | `/api/tickets/:id/include-final-test-files` | Resolve a `FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED` block by marking all unclassified final-test-produced files as PR candidates and retrying integration |
| `POST` | `/api/tickets/:id/discard-final-test-files` | Resolve a `FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED` block by discarding only audited final-test-produced dirty files and retrying integration |
| `POST` | `/api/tickets/:id/dev-event` | Disabled by default; requires `LOOPTROOP_ENABLE_DEV_EVENT=1`, `LOOPTROOP_DEV_EVENT_TOKEN`, and `X-LoopTroop-Dev-Event-Token` |

All approval routes, including the generic `/approve` route, require the hash of the content currently shown to the user:

```json
{
  "expectedContentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Malformed or missing hashes return `400`. If the current server artifact no longer matches the expected hash, the route returns `409` and leaves the workflow paused:

```json
{
  "error": "Stale approval",
  "artifactType": "prd",
  "expectedContentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "currentContentSha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}
```

Successful approvals write durable `approval_receipt` phase artifacts. Approval snapshots and receipts include `content_sha256`; interview and PRD receipts also include `stored_content_sha256` when approval stamping changes the persisted YAML.

The Continue endpoint is available only from `BLOCKED_ERROR`. It requires a known `previousStatus`, an unresolved active error occurrence with a diagnostic `sessionId`, a matching active `opencode_sessions` row for that ticket and previous phase, and an OpenCode session that is still addressable by that exact id. It returns `409` and leaves the ticket blocked when those checks fail. On success it dispatches `CONTINUE`, records the pending session continuation, and the next owned prompt sends exactly `continue please` without creating a fresh phase attempt.

The final-test file-effects recovery endpoints are available only from `BLOCKED_ERROR` when the active error code is `FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED` and the previous status is `INTEGRATING_CHANGES`. `include-final-test-files` writes a `final_test_file_effects_override` artifact with `include_unclassified_as_candidate`; `discard-final-test-files` removes/reverts only files listed by the latest `final_test_file_effects_audit` as produced or changed during final testing, then writes a `discard_unclassified` override. Both routes dispatch `RETRY` into a fresh integration attempt and do not use the OpenCode `/continue` session path.

The cancel endpoint accepts an optional JSON request body to trigger cleanup at cancellation time. Both fields default to `false`; the ticket record itself is never deleted.

```json
{
  "deleteContent": false,
  "deleteLog": false
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `deleteContent` | `boolean` | `false` | Permanently removes all AI-generated artifacts (interview Q&A, PRD drafts, beads plan) from the database and deletes the isolated git worktree and its branch |
| `deleteLog` | `boolean` | `false` | Permanently removes the execution log files (`.ticket/runtime/execution-log.jsonl`, `.ticket/runtime/execution-log.debug.jsonl`, and `.ticket/runtime/execution-log.ai.jsonl`) for this ticket. This is only effective when the worktree still exists; if `deleteContent` is also `true` the worktree removal already covers the logs |

### Interview And Planning Editing

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/interview` | Returns interview payload with `winnerId`, `raw`, `document`, `session`, and `questions` |
| `PUT` | `/api/tickets/:id/interview` | Save raw interview YAML |
| `PUT` | `/api/tickets/:id/interview-answers` | Save structured interview answers during approval or planning restart |
| `POST` | `/api/tickets/:id/answer` | Deprecated, returns `410`; use `answer-batch` |
| `POST` | `/api/tickets/:id/answer-batch` | Submit interview answers |
| `POST` | `/api/tickets/:id/skip` | Skip remaining interview questions |
| `PATCH` | `/api/tickets/:id/edit-answer` | Edit a previously recorded answer while waiting for interview answers |

Interview responses include `contentSha256` for the reviewed raw interview bytes. PRD file responses from `/api/files/:ticketId/prd` include `contentSha256` for the returned file content.

Interview and PRD approval edits are planning-only. After approval, saving an interview edit is allowed while the ticket is still before `PRE_FLIGHT_CHECK`; if PRD or beads planning already exists, LoopTroop archives the current approved interview version and downstream PRD/beads phase attempts, cancels active downstream sessions as intentional cancellation, clears stale downstream artifacts and approval UI state, writes a `user_edit_receipt:interview` artifact, saves and approves the edited interview as the new active version, and starts `DRAFTING_PRD`. Saving a PRD edit follows the same contract for the current approved PRD version and downstream beads attempts, writes `user_edit_receipt:prd`, then starts `DRAFTING_BEADS`.

Archived versions are read-only approved planning generations backed by phase attempts. Once a ticket reaches `PRE_FLIGHT_CHECK` or any later execution-band status, interview and PRD edit saves return `409`. Intentional downstream session aborts during these planning restarts are cancellation, not blocked errors, and existing tickets/projects such as `PCKM-22` are not migrated or repaired.

Current batch-answer payload:

```json
{
  "answers": {
    "q-auth-1": "Support both password login and SSO."
  },
  "selectedOptions": {
    "q-auth-2": ["option-password", "option-sso"]
  }
}
```

Possible `answer-batch` response shapes:

`202 { "accepted": true }` means the user answers were accepted and asynchronous AI processing is continuing in the background. A non-complete batch response keeps the ticket in `WAITING_INTERVIEW_ANSWERS` with another batch to answer. When `isComplete` is `true`, the backend dispatches interview completion and the workflow advances to coverage.

```json
{
  "accepted": true
}
```

```json
{
  "questions": [
    {
      "id": "q-auth-3",
      "question": "What session lifetime should SSO tokens use?",
      "type": "free_text"
    }
  ],
  "progress": {
    "current": 4,
    "total": 8
  },
  "isComplete": false,
  "isFinalFreeForm": false,
  "aiCommentary": "Need one more clarification about session lifetime.",
  "batchNumber": 2,
  "source": "coverage",
  "roundNumber": 1
}
```

Structured interview-answer approval payload:

```json
{
  "questions": [
    {
      "id": "q-auth-1",
      "answer": {
        "skipped": false,
        "selected_option_ids": [],
        "free_text": "Support password login and SSO."
      }
    }
  ]
}
```

### Execution Setup Plan Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/execution-setup-plan` | Read the current setup plan |
| `PUT` | `/api/tickets/:id/execution-setup-plan` | Save setup plan as raw content or structured plan |
| `POST` | `/api/tickets/:id/regenerate-execution-setup-plan` | Regenerate the plan with commentary |

Execution setup plan read response:

```json
{
  "exists": true,
  "artifactId": 42,
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "contentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "raw": "{\"schemaVersion\":1,\"ticketId\":\"AUTH-12\",\"artifact\":\"execution_setup_plan\",\"status\":\"draft\",\"summary\":\"Prepare the workspace before implementation.\"}",
  "plan": {
    "schemaVersion": 1,
    "ticketId": "AUTH-12",
    "artifact": "execution_setup_plan",
    "status": "draft",
    "summary": "Prepare the workspace before implementation.",
    "readiness": {
      "status": "ready",
      "actionsRequired": false,
      "evidence": ["Dependencies are already installed."],
      "gaps": []
    },
    "tempRoots": [".looptroop/worktrees/AUTH-12"],
    "steps": [
      {
        "id": "setup-1",
        "title": "Install dependencies",
        "purpose": "Ensure commands run with the expected packages.",
        "commands": ["npm install"],
        "required": true,
        "rationale": "The project uses npm scripts for verification.",
        "cautions": ["Do not update unrelated dependencies."]
      }
    ],
    "projectCommands": {
      "prepare": ["npm install"],
      "testFull": ["npm test"],
      "lintFull": ["npm run lint"],
      "typecheckFull": ["npm run typecheck"]
    },
    "qualityGatePolicy": {
      "tests": "Run targeted tests first, then the full suite before handoff.",
      "lint": "Run the project linter after code changes.",
      "typecheck": "Run TypeScript typecheck after code changes.",
      "fullProjectFallback": "If targeted checks are inconclusive, run all required project checks."
    },
    "cautions": ["Keep generated artifacts out of source control."]
  }
}
```

Execution setup plan reads may select archived versions with `phaseAttempt`. Archived reads stay available, but explicit writes to non-current phase attempts return `409` because archived versions are read-only. Successful manual saves write `user_edit_receipt:execution_setup_plan`.

`PUT /execution-setup-plan` and `POST /regenerate-execution-setup-plan` are normally accepted only while the ticket is in `WAITING_EXECUTION_SETUP_APPROVAL`. They are also accepted from `PREPARING_EXECUTION_ENV` as a one-step runtime rewind: LoopTroop stops active runtime setup, archives the approved setup-plan attempt and current runtime attempt with `execution_setup_runtime_rewind`, clears stale setup profile/runtime outputs while preserving `.ticket/runtime/execution-setup/tool-cache`, returns the ticket to `WAITING_EXECUTION_SETUP_APPROVAL`, and requires approval again. These routes still reject from `CODING` and later statuses.

Regeneration payload:

```json
{
  "commentary": "Tighten the temp-root cleanup steps and add the full lint command.",
  "plan": {
    "schemaVersion": 1,
    "ticketId": "AUTH-12",
    "artifact": "execution_setup_plan",
    "status": "draft",
    "summary": "Prepare the workspace before implementation.",
    "readiness": {
      "status": "ready",
      "actionsRequired": false,
      "evidence": [],
      "gaps": []
    },
    "tempRoots": [],
    "steps": [],
    "projectCommands": {
      "prepare": [],
      "testFull": ["npm test"],
      "lintFull": ["npm run lint"],
      "typecheckFull": ["npm run typecheck"]
    },
    "qualityGatePolicy": {
      "tests": "Run full tests before handoff.",
      "lint": "Run lint before handoff.",
      "typecheck": "Run typecheck before handoff.",
      "fullProjectFallback": "Run all required project checks when unsure."
    },
    "cautions": []
  }
}
```

### OpenCode Question Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/opencode/questions` | Aggregate pending OpenCode question requests across active tickets |
| `GET` | `/api/tickets/:id/opencode/questions` | List pending OpenCode question requests |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reply` | Submit question answers |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reject` | Reject a question request |

Reply payload:

```json
{
  "answers": [
    ["yes"],
    ["postgres", "redis"]
  ]
}
```

### Artifact And History Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/artifacts` | List ticket artifacts, optionally filtered |
| `GET` | `/api/tickets/:id/phases/:phase/attempts` | List phase attempt history |

Ticket list and detail responses include a cleanup summary derived from the latest `cleanup_report` artifact:

```json
{
  "cleanup": {
    "status": "warning",
    "errorCount": 2,
    "latestReportArtifactId": 123
  }
}
```

`cleanup.status` is `clean`, `warning`, or `null`. Cleanup warnings do not change the ticket's terminal `COMPLETED` status.

## File Routes

These routes are intentionally narrow.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/files/:ticketId/logs` | Read folded normal execution logs from `.ticket/runtime/execution-log.jsonl` |
| `GET` | `/api/files/:ticketId/logs?channel=debug` | Read folded debug/forensic execution logs from `.ticket/runtime/execution-log.debug.jsonl`; the same `status`, `phase`, and `phaseAttempt` filters apply |
| `GET` | `/api/files/:ticketId/logs?channel=ai` | Read folded AI detail logs from `.ticket/runtime/execution-log.ai.jsonl`; loaded by AI/model log views |
| `GET` | `/api/files/:ticketId/logs?channel=all` | Merge all three LoopTroop log files plus OpenCode native server log lines filtered by the ticket's session IDs; used by the DEBUG tab to show every log line |
| `GET` | `/api/files/:ticketId/:file` | Only `interview` or `prd`; existing file responses include `contentSha256` |
| `PUT` | `/api/files/:ticketId/:file` | Only `interview` or `prd` |

Log routes accept optional `status`, `phase`, and `phaseAttempt` filters. The same filters apply to the default normal log channel, `channel=debug`, and `channel=ai`. The `channel=all` endpoint merges and deduplicates entries from all channels server-side, then sorts by timestamp; phase/status filters still apply to LoopTroop log entries but OpenCode native log entries (which have no ticket phase) are always included. Matching completed log entries are returned from the durable log files without an entry-count cap; streaming partial upserts are folded so the UI receives the latest completed or current streaming row for each stable entry.

There is no generic filesystem browser or arbitrary file read route under `/api/files`.

## Bead Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/beads` | Read bead plan; accepts optional safe relative `?flow=` |
| `PUT` | `/api/tickets/:id/beads` | Replace bead plan only while the ticket is in `WAITING_BEADS_APPROVAL`; accepts optional safe relative `?flow=` |
| `GET` | `/api/tickets/:id/beads/:beadId/diff` | Read diff artifact for a bead |

The `flow` value must be a safe relative branch/flow name. Absolute paths, backslashes, `.` segments, and `..` traversal segments are rejected. Bead reads and writes expose the canonical plan hash through the `X-Content-Sha256` response header. Manual bead edits write `user_edit_receipt:beads` and invalidate the execution setup plan.

## SSE Events

The stream endpoint emits two categories of events:

**Stream lifecycle events** — sent directly by the stream handler on connection and periodically, not through the broadcaster:

- `connected` — emitted once when the SSE connection is established
- `heartbeat` — emitted every 30 seconds to keep the connection alive

**Typed ticket events** — broadcast through `server/sse/broadcaster.ts` and defined in `server/sse/eventTypes.ts`:

- `state_change`
- `log`
- `progress`
- `app_error`
- `bead_complete`
- `needs_input`
- `artifact_change`

SSE replay is an optimization, not the only recovery path. After a reconnect with a remembered event id, the frontend also invalidates the ticket, list, artifacts, interview, setup-plan, bead, and server-log queries so missed events outside the replay buffer are reconciled from durable storage.

Example `state_change` event payload:

```json
{
  "ticketId": "AUTH-12",
  "from": "DRAFTING_PRD",
  "to": "WAITING_PRD_APPROVAL",
  "previousStatus": "VERIFYING_PRD_COVERAGE",
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

Example `artifact_change` event payload:

```json
{
  "ticketId": "AUTH-12",
  "phase": "CODING",
  "artifactType": "bead_diff:api-refresh-endpoint",
  "artifact": {
    "id": 84,
    "ticketId": "AUTH-12",
    "phase": "CODING",
    "phaseAttempt": 1,
    "artifactType": "bead_diff:api-refresh-endpoint",
    "filePath": null,
    "content": "diff --git a/server/routes/auth.ts b/server/routes/auth.ts\n...",
    "createdAt": "2026-04-23T09:00:00.000Z",
    "updatedAt": "2026-04-23T09:00:00.000Z"
  },
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

## Related Docs

- [Frontend](frontend.md)
- [OpenCode Integration](opencode-integration.md)
- [State Machine](state-machine.md)
- [System Architecture](system-architecture.md)
