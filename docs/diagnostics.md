# Runtime Diagnostics

> [!IMPORTANT]
> **TL;DR** — When a ticket blocks or behaves unexpectedly, LoopTroop surfaces structured diagnostics: provider errors, session state, timeout details, retry history, and OpenCode log correlation — so you know exactly what failed and why.

LoopTroop includes a local runtime diagnostic command for investigating slow refreshes, intermittent stalls, missing tickets after reload, OpenCode reachability problems, and machine-level resource pressure.

Run it while `npm run dev` is already running, ideally during the slowdown:

```bash
npm run diagnose:stall
```

The command writes a timestamped report under `tmp/diagnostics/`, for example:

```text
tmp/diagnostics/runtime-stall-YYYYMMDD-HHMMSS.log
```

## 1. Platform Support

The diagnostic script runs on **Linux**, **WSL2**, **macOS**, and **Windows**.

| Feature | Linux/WSL | macOS | Windows |
|---|---|---|---|
| Process `/proc` inspection | ✅ | — | — |
| Pressure-stall metrics | ✅ | — | — |
| Cgroup resource snapshot | ✅ | — | — |
| TCP stats | ✅ (ss) | ✅ (netstat) | ✅ (netstat) |
| FD limits | ✅ | ✅ | — |
| Zombie process count | ✅ | ✅ | — |
| macOS vm_stat / top | — | ✅ | — |
| Shell baseline | bash / sh | bash / sh | PowerShell |

## 2. What It Captures

The report is read-only. It does not repair state, mutate tickets, or modify attached projects.

It captures:

- **Disk Write Latency** — Direct measurement of storage responsiveness (crucial for WSL/mounted drive diagnostics).
- frontend, backend, ticket-list, project-list, startup-status, and OpenCode health probe latency
- repeated backend health and ticket-list samples
- a 3-minute runtime observation window that samples backend health, `/api/tickets`, watched process CPU/RSS/I/O, Linux pressure deltas, app/project DB/WAL/log growth, and trend-wide top system CPU/RSS/read/write leaders
- backend, frontend, and OpenCode process memory, thread, wait-state, file descriptor, CPU, and I/O activity
- whole-system top CPU, RSS, read-I/O, and write-I/O consumers during the sample window and across the runtime trend
- system load, memory, Linux pressure-stall metrics, cgroup resource state, `vmstat`, and `iostat` or `/proc/diskstats`
- workspace, app DB, and attached-project mount, disk, inode, SQLite, WAL, and filesystem latency data
- attached project ticket counts, active OpenCode sessions, recent ticket states, execution-log tail, and git responsiveness
- optional focused ticket runtime artifact checks when `--ticket-path` is provided, including log growth, runtime disk usage, largest directories, and large files such as build outputs
- **Advanced Diagnostics**: event-loop lag, DNS probe, FD limits, TCP connection states, zombie process count, diagnostic heap snapshot, and swap pressure
- macOS-specific: `vm_stat`, load average, CPU count, and top processes (macOS only)

## 3. OpenCode Provider Errors

OpenCode sometimes streams only `Provider returned error` even though its local log contains the exact API failure. LoopTroop automatically correlates those generic stream errors with the newest OpenCode log files by `session.id` and surfaces a sanitized provider summary in ticket logs and blocked-error diagnostics when a match exists.

The enrichment records only compact diagnostic fields such as HTTP status, retryability, provider/model identity, request model, provider error type/title/message, and a short response-body preview. It does not persist prompt bodies, raw request payloads, headers, cookies, authorization values, or URL query strings. For managed local servers, the default OpenCode log directory is used. For external or nonstandard servers, set `LOOPTROOP_OPENCODE_LOG_DIR` to the directory containing OpenCode's log files.

If no matching local log exists, the ticket keeps the generic error and includes a hint to configure `LOOPTROOP_OPENCODE_LOG_DIR` for external or nonstandard OpenCode servers.

## 4. Useful Options

```bash
npm run diagnose:stall -- --timeout-ms 8000
```

Use a larger timeout if the app is already struggling and you want slow probes to complete instead of timing out quickly.

```bash
npm run diagnose:stall -- --sample-ms 5000
```

Use a longer sample window when CPU or I/O spikes are brief and hard to catch. The default is `1000ms`.

```bash
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
```

Use a different trend window when you need to catch changing latency, process spikes, pressure-stall movement, or growing DB/WAL/log files over time. The default is `180000ms` (3 minutes); pass `--trend-ms 0` to disable it.

```bash
npm run diagnose:stall -- --ticket-path /path/to/worktree/.ticket
```

Focus the report on one ticket runtime. You can pass the `.ticket` directory, its `runtime` directory, or the ticket worktree root. The trend watches that ticket's runtime logs, and the storage section reports the runtime directory's largest subdirectories and files.

```bash
npm run diagnose:stall -- --backend-port 3001 --frontend-port 5175 --opencode-url http://127.0.0.1:4097
```

Use explicit ports if you started the stack with non-default runtime ports.

```bash
npm run diagnose:stall -- --no-color
```

Disable colored output. Useful when piping or running in CI. Also respected via the `NO_COLOR` environment variable.

## 5. Reading The Report

Read the report by category:

- **🔍 ENVIRONMENT & CONFIGURATION**: Resolved ports, PIDs, shell startup latency, and backend env vars.
- **🌐 NETWORK & ENDPOINT HEALTH**: HTTP probe results for frontend, backend, and OpenCode.
- **🔁 STALL CORRELATION SAMPLES**: Repeated backend/ticket probes — whether the app was actually unresponsive during capture.
- **Runtime Observation Trend**: Per-interval backend health, `/api/tickets`, watched process, pressure, and file-growth changes, plus watched-process totals and trend-wide whole-system top CPU/RSS/read/write consumers.
- **⚙️ APPLICATION PROCESS ACTIVITY**: Per-process CPU, I/O, FD counts, and memory for backend, frontend, and OpenCode.
- **💻 SYSTEM RESOURCES**: Pressure-stall metrics, cgroup state, uptime, memory, and top process consumers.
- **💾 STORAGE, MOUNTS & FILESYSTEM**: Mount type, disk space, inodes, and filesystem latency for workspace and project paths. When `--ticket-path` is used, this section also shows focused ticket runtime artifact sizes and large-file suspects.
- **🗄️ DATABASE & PROJECT STATE**: App DB and project DB inspection, WAL/SHM file sizes, ticket and session state.
- **🔀 GIT RESPONSIVENESS**: Git status, Trace2 perf output, and branch resolution for attached projects.
- **🧬 ADVANCED DIAGNOSTICS**: Event-loop lag, DNS probe for localhost, FD limits, TCP states, zombie count, diagnostic heap, and swap pressure.

For intermittent stalls, save at least one report from a healthy moment and one from a slow moment. The differences are usually more useful than either report alone.

## 6. Error Diagnostics Normalization

Every blocked-error occurrence stores a structured diagnostic record normalized by `shared/errorDiagnostics.ts`. When a phase fails, the raw error data is passed through `normalizeBlockedErrorDiagnostics()` before being persisted.

### 6.1 Diagnostic Classification

Each diagnostic is classified along two dimensions:

**Kind** (`BlockedErrorDiagnosticKind`) — describes the nature of the failure:

| Kind | Meaning |
| --- | --- |
| `model_output_truncated` | The model response was cut off (OpenCode `length` finish reason) |
| `opencode_provider` | The OpenCode provider returned an error |
| `opencode_session` | A session-level failure (creation, reconnect, or abandonment) |
| `timeout` | A prompt or execution deadline was exceeded |
| `transport` | A network or transport-level failure |
| `runtime` | An internal runtime error (state machine, storage, or unexpected condition) |
| `unknown` | The error could not be classified |

**Source** (`BlockedErrorDiagnosticSource`) — identifies the origin:

| Source | Meaning |
| --- | --- |
| `opencode` | Originated from the OpenCode integration layer |
| `provider` | Originated from the model provider (API error, rate limit, etc.) |
| `system` | Originated from the LoopTroop runtime |
| `runtime` | Originated from a runtime execution error |

### 6.2 Sensitive Data Redaction

Before any diagnostic is persisted, `normalizeBlockedErrorDiagnostics()` applies credential redaction:

- **API keys, tokens, and passwords** in error messages are replaced with `[REDACTED]` using a pre-compiled regex pattern that covers common credential formats (`sk-...`, `Bearer ...`, `Authorization: ...`, etc.).
- **URL query strings** are removed from error messages to prevent inadvertently logging tokens or secrets passed as query parameters.
- The redacted payload preserves the diagnostic structure (status code, error type, model identity, token counts) so the failure remains debuggable without exposing sensitive data.

### 6.3 Diagnostic Fields

A normalized diagnostic record may include:

| Field | Description |
| --- | --- |
| `modelId` | The model that was being used (sanitized) |
| `sessionId` | The OpenCode session ID involved |
| `providerId` | The provider identifier |
| `statusCode` | HTTP status code when applicable |
| `tokens` | Token usage information when available |
| `errorType` | Classified error type string |
| `errorMessage` | Redacted error description |
| `retryable` | Whether the error is eligible for automatic retry |
| `failureClass` | Structured failure classification for retry logic |
