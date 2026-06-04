# Runtime Diagnostics

> [!IMPORTANT]
> **TL;DR** — LoopTroop exposes three different diagnostic surfaces: a local runtime-stall report, persisted blocked-error diagnostics on ticket failures, and structured retry diagnostics on artifacts that needed correction or re-prompting. Use the surface that matches the failure mode instead of treating everything as a generic "the ticket broke" event.

This page covers the diagnostics that help explain slow local behavior, blocked ticket runs, and recoverable structured-output failures.

## 1. Choose the Right Diagnostic Surface

| Surface | When it appears | Where to inspect it | Best for |
| --- | --- | --- | --- |
| Runtime stall report | You run `npm run diagnose:stall` while the app is slow or behaving oddly | `tmp/diagnostics/runtime-stall-*.log` | Slow refreshes, missing tickets after reload, OpenCode reachability issues, disk / CPU / memory pressure |
| Blocked-error diagnostics | A phase ends in `BLOCKED_ERROR` | Ticket error view and persisted error occurrence data | Provider failures, timeouts, session errors, transport failures, model output truncation |
| Structured retry diagnostics | A structured-output phase rejects one or more model attempts before validating or finally failing | Artifact processing notices and artifact detail views | Why a response was retried, what validation failed, and what excerpt caused the retry |

## 2. Runtime Stall Report

Run the report while `npm run dev` is still running, ideally during the slowdown:

```bash
npm run diagnose:stall
```

The command writes a timestamped local report under `tmp/diagnostics/`, for example:

```text
tmp/diagnostics/runtime-stall-YYYYMMDD-HHMMSS.log
```

The script is read-only. It does not mutate tickets, repair databases, or modify attached projects.

### 2.1 Platform Support

The diagnostic script runs on **Linux**, **WSL2**, **macOS**, and **Windows**.

| Feature | Linux/WSL | macOS | Windows |
| --- | --- | --- | --- |
| Process `/proc` inspection | ✅ | — | — |
| Pressure-stall metrics | ✅ | — | — |
| Cgroup resource snapshot | ✅ | — | — |
| TCP stats | ✅ (`ss`) | ✅ (`netstat`) | ✅ (`netstat`) |
| FD limits | ✅ | ✅ | — |
| Zombie process count | ✅ | ✅ | — |
| `vm_stat` / `top` integration | — | ✅ | — |
| Shell baseline | bash / sh | bash / sh | PowerShell |

Platform-specific sections that are unavailable simply show as unavailable or `n/a`; the report still runs.

### 2.2 What the Report Captures

The report combines several layers of evidence:

- **Environment and startup context** — resolved ports, candidate/listener PIDs, backend env snapshot, watcher context, shell startup latency, and focused ticket path resolution.
- **Endpoint probes** — frontend, backend health, startup status, projects, tickets, and OpenCode reachability.
- **Short repeated samples** — repeated backend and ticket probes to confirm whether the app was actually stalled during capture.
- **Runtime trend window** — by default a 3-minute trend that samples backend health, `/api/tickets`, watched-process CPU/RSS/I/O, Linux pressure deltas, app/project DB and log growth, and trend-wide whole-system read/write/RSS/CPU leaders.
- **Process activity** — backend, frontend, and OpenCode memory snapshots, wait state, thread count, FD count, and I/O counters.
- **System resource state** — load, memory, pressure-stall metrics, cgroup state, `vmstat`, disk stats, and top resource consumers.
- **Storage and project state** — mount type, free space, inode usage, filesystem latency, SQLite / WAL / SHM sizes, project ticket/session state, and Git responsiveness.
- **Focused ticket runtime sizing** — when `--ticket-path` is supplied, the report also tracks runtime log growth, largest runtime subdirectories, and large artifact files such as build outputs.
- **Advanced probes** — event-loop lag, localhost DNS probe, TCP states, zombie process count, swap pressure, and a diagnostic heap snapshot.

### 2.3 Useful Flags

| Flag | Default | Use it when |
| --- | --- | --- |
| `--timeout-ms <ms>` | `4000` | Probes are timing out too aggressively and you want slow endpoints or shell checks to finish |
| `--sample-ms <ms>` | `1000` | CPU or I/O spikes are brief and you want a wider one-window process sample |
| `--trend-ms <ms>` | `180000` | You want a longer or shorter observation window; use `0` to disable the trend entirely |
| `--trend-interval-ms <ms>` | `1000` | You want finer or coarser trend granularity |
| `--ticket-path <path>` | none | You want runtime sizing focused on one ticket; pass a `.ticket` dir, its `runtime` dir, or the worktree root |
| `--backend-port`, `--frontend-port`, `--opencode-url` | auto-detect when possible | You started the stack on non-default ports or against a non-default OpenCode server |
| `--no-color` | off | You are piping the report or running in CI; `NO_COLOR` is also respected |

Examples:

```bash
npm run diagnose:stall -- --timeout-ms 8000
npm run diagnose:stall -- --sample-ms 5000
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
npm run diagnose:stall -- --ticket-path /path/to/worktree/.ticket
npm run diagnose:stall -- --backend-port 3001 --frontend-port 5175 --opencode-url http://127.0.0.1:4097
```

### 2.4 Reading the Report

The top-level sections map directly to the report banners:

- **🔍 ENVIRONMENT & CONFIGURATION** — resolved ports, detected PIDs, backend env vars, shell latency baseline, and focused ticket path resolution.
- **🌐 NETWORK & ENDPOINT HEALTH** — current HTTP probe results for frontend, backend, ticket/project routes, startup status, and OpenCode.
- **🔁 REPEATED RUNTIME SAMPLES** — repeated backend/ticket probes plus the longer `Runtime Observation Trend` output.
- **⚙️ APPLICATION PROCESS ACTIVITY** — backend/frontend/OpenCode candidate processes, memory snapshots, open files, and per-process CPU / I/O samples.
- **💻 SYSTEM RESOURCES** — pressure, memory, uptime, and whole-system top CPU / RSS / read / write consumers.
- **💾 STORAGE, MOUNTS & FILESYSTEM** — mount details, disk and inode usage, filesystem latency, and optional focused ticket-runtime sizing.
- **🗄️ DATABASE & PROJECT STATE** — app DB pathing, project DB/WAL state, recent ticket/session state, and execution-log tailing.
- **🔀 GIT RESPONSIVENESS** — `git status`, Trace2 perf output, branch resolution, and other responsiveness checks for attached repos.
- **🧬 ADVANCED DIAGNOSTICS** — event-loop lag, DNS, TCP state counts, zombie counts, swap pressure, and diagnostic heap output.

For intermittent issues, save at least one report from a healthy moment and one from a slow moment. The diff between the two is usually more useful than either report alone.

## 3. Blocked-Error Diagnostics

When a phase fails hard enough to enter `BLOCKED_ERROR`, LoopTroop persists a normalized diagnostic payload alongside the error occurrence. That payload is normalized by `shared/errorDiagnostics.ts`, typically assembled by `server/opencode/blockedErrorDiagnostics.ts`, and rendered in the ticket error view as **Underlying error**.

Use this surface when the ticket already blocked and you want the reason, not the whole-machine health picture.

### 3.1 OpenCode Provider Error Enrichment

OpenCode sometimes streams only `Provider returned error` even though its local log contains the exact provider failure. LoopTroop best-effort correlates those generic stream errors with recent OpenCode log files by `session.id` and replaces the generic summary with a sanitized provider summary when a match exists.

The enrichment keeps only compact diagnostic fields such as HTTP status, retryability, provider/model identity, request model, provider error type/title/message, and a short response-body preview. It does **not** persist prompt bodies, raw request payloads, headers, cookies, authorization values, or URL query strings.

- Managed local OpenCode: LoopTroop checks the default local OpenCode log directory.
- External or nonstandard OpenCode: set `LOOPTROOP_OPENCODE_LOG_DIR` to the log directory.
- No matching log found: the ticket keeps the generic provider error and adds a troubleshooting hint instead of inventing details.

### 3.2 Diagnostic Classification

Each blocked-error diagnostic has a normalized `kind` and `source`.

**Kind** (`BlockedErrorDiagnosticKind`)

| Kind | Meaning |
| --- | --- |
| `model_output_truncated` | OpenCode reported a finish reason such as `length`, so the model response was cut off |
| `opencode_provider` | The provider returned an API-style failure such as auth, quota, rate limit, or invalid request |
| `opencode_session` | Session creation, reconnect, or session-level lifecycle failure |
| `timeout` | A prompt or execution deadline was exceeded |
| `transport` | Connection reset, DNS, socket, or other transport failure |
| `runtime` | Internal LoopTroop runtime or orchestration failure |
| `unknown` | The failure could not be classified |

**Source** (`BlockedErrorDiagnosticSource`)

| Source | Meaning |
| --- | --- |
| `opencode` | Originated from the OpenCode integration layer |
| `provider` | Originated from the underlying model provider |
| `system` | Originated from a LoopTroop system-level source |
| `runtime` | Originated from a runtime execution error |

In the main OpenCode blocked-error builder, provider-like failures are currently emitted with source `provider`; the other generated OpenCode failure kinds use source `opencode`.

### 3.3 Sensitive Data Redaction

Before persistence, `normalizeBlockedErrorDiagnostics()` sanitizes string fields:

- API keys, bearer tokens, passwords, and similar secrets are replaced with `[redacted]`.
- Query strings are stripped from error text so token-like values in URLs are not persisted.
- The redacted payload still keeps enough structure to debug the issue: status codes, provider/model identity, finish reason, and token counts survive when present.

### 3.4 Persisted Fields

The normalized blocked-error payload may include:

| Field | Meaning |
| --- | --- |
| `summary` | Required short explanation shown in the UI when it differs from the primary ticket error |
| `modelId` | LoopTroop/OpenCode model identifier used for the failed run |
| `sessionId` | OpenCode session involved in the failure |
| `providerId` | Provider identifier such as `openai` |
| `providerModelId` | Provider-native model identifier when it differs from the requested model |
| `requestModel` | Exact request model recorded by provider diagnostics |
| `statusCode` | HTTP status code when available |
| `isRetryable` | Whether provider diagnostics marked the failure as retryable |
| `providerErrorType` | Provider error type/classification |
| `providerErrorTitle` | Provider error title or headline |
| `providerErrorMessage` | Redacted provider error message |
| `responseBodyPreview` | Short redacted preview of the provider response body |
| `finishReason` | OpenCode finish reason for truncation-style failures |
| `inputTokens` / `outputTokens` / `reasoningTokens` | Token counts reported by OpenCode |
| `cacheReadTokens` / `cacheWriteTokens` | Token-cache counts when OpenCode exposes them |

The current compact blocked-error panel renders the most actionable subset of those fields. Less common fields, such as `responseBodyPreview` and cache token counts, can still exist in persisted payloads even if that panel does not show them today.

## 4. Structured Retry Diagnostics

Structured retry diagnostics explain **recoverable** structured-output failures. They are normalized by `shared/structuredRetryDiagnostics.ts`, merged into structured-output metadata by `server/structuredOutput/metadata.ts`, and rendered in artifact notices / viewers as **Retry Attempts**.

Use this surface when a phase kept going after rejecting one or more malformed outputs, or when a final failed artifact needs to show exactly why previous attempts were rejected.

### 4.1 What Gets Stored

Each retry entry captures one rejected attempt:

| Field | Meaning |
| --- | --- |
| `attempt` | 1-based retry attempt number |
| `validationError` | Why the parser or validator rejected that attempt |
| `failureClass` | Optional coarse classification such as `validation_error`, `output_truncated`, `empty_response`, `provider_error`, `connection_reset`, `session_protocol_error`, or `transport_error` |
| `target` | Optional target field or schema area that failed |
| `line` / `column` | Optional location for line-oriented parse failures |
| `excerpt` | Best-effort trimmed excerpt from the rejected output |

Malformed retry entries are dropped during normalization, and duplicate retry entries are collapsed so the UI does not show the same failure repeatedly.

### 4.2 Where It Shows Up

Structured retry diagnostics currently surface in artifact-oriented UI rather than the blocked-error panel:

- artifact processing notices
- expanded artifact viewers
- per-owner aggregate vote views when retry metadata exists on contributing artifacts

These diagnostics complement blocked-error diagnostics rather than replacing them:

- **Blocked-error diagnostics** answer "why did the ticket stop?"
- **Structured retry diagnostics** answer "why was this earlier model output rejected before we recovered or finally gave up?"

## Related Docs

- [Operations Guide](operations.md)
- [OpenCode Integration](opencode-integration.md)
- [Output Normalization](output-normalization.md)
