# Post-Implementation

Post-implementation is LoopTroop's delivery pipeline. After `CODING` finishes, LoopTroop does **not** immediately push or merge the result. It first validates the whole ticket, turns bead-level history into one candidate commit, audits the final diff again before any remote side effects, pauses for human PR review, and only then removes temporary runtime state.

This stage is intentionally conservative: final testing can still block delivery, integration will not continue past unresolved final-test file effects, PR creation can still rewrite the candidate to exclude unrelated byproducts, and cleanup preserves the audit trail rather than deleting evidence.

| Status | Purpose | Main outputs |
| --- | --- | --- |
| `RUNNING_FINAL_TEST` | Generate and run ticket-level verification against the completed implementation. | `final_test_report`, `final_test_retry_notes`, `final_test_file_effects_audit` |
| `GENERATING_QA_CHECKLIST` | Prepare a clean checkpoint and versioned human checklist when Manual QA is locked on. | `manual_qa_checklist`, coverage, reservation, workspace baseline |
| `WAITING_MANUAL_QA` | Wait for user-run verification, evidence, submit/skip, and any drift decision. | draft/results/summary, evidence refs, fix beads, improvement tickets |
| `INTEGRATING_CHANGES` | Turn bead-level commits into one local candidate commit. | `integration_report` |
| `CREATING_PULL_REQUEST` | Audit the final candidate files, push the candidate SHA, and create or update the draft PR. | `candidate_file_audit`, `candidate_diff`, `pull_request_report`, optional `git_recovery_receipt` on failure |
| `WAITING_PR_REVIEW` | Pause automation for the final human review and merge/finish decision. | `merge_report` |
| `CLEANING_ENV` | Remove temporary runtime state while preserving audit history. | `cleanup_report` |

---

## 1. `RUNNING_FINAL_TEST`: ticket-level verification

After all beads are done, LoopTroop verifies the **whole** ticket result, not just each bead in isolation.

### 1.1 Structured plan generation

LoopTroop asks the locked main implementer to generate a structured final-test plan from:

- ticket details
- the approved PRD
- the approved beads plan
- any accumulated `final_test_retry_notes`

The model returns test commands plus language-agnostic `file_effects` declarations that classify files it expects final testing to create or change as:

- `candidate`
- `temporary`
- `unexpected`

Malformed final-test plans do not silently pass through. LoopTroop applies the normal structured-output retry flow, preserves raw attempts for inspection, and records the accepted or rejected output in the final-test artifacts.

### 1.2 Executing commands with the approved runtime profile

The generated commands run sequentially in the ticket worktree. If pre-implementation produced a reusable execution wrapper, LoopTroop automatically applies it to generated commands that do not already use it. The final test report records both the original command and the effective wrapped command when wrapping is used.

The resulting `final_test_report` captures:

- per-command stdout/stderr, exit code, timeout state, and duration
- plan metadata such as `plannedBy`, `summary`, `testsCount`, and raw model output
- structured-output diagnostics and raw attempts when plan generation needed repair
- attempt history and retry notes when final testing needed more than one try

### 1.3 Retry and reset behavior

If a final-test attempt fails, LoopTroop appends a retry note, resets tracked repository files back to the final-test start commit, preserves LoopTroop-owned artifacts under `.ticket`, and tries again until the ticket's normal iteration budget is exhausted. If the retries run out, the workflow routes to `BLOCKED_ERROR`.

### 1.4 Final-test file effects audit

When a final-test attempt passes, LoopTroop compares git-visible dirty files from **before** the passing attempt against the dirty files **after** it. That produces a `final_test_file_effects_audit` artifact containing:

- baseline dirty files
- dirty files after testing
- files produced or changed by final testing
- declared `file_effects`
- classified `candidate`, `temporary`, and `unexpected` files
- any `unclassified` files that still need a human decision

Integration only carries forward **audited candidate files** from this pass. If final testing leaves dirty files that were not declared, integration blocks with `FINAL_TEST_FILE_EFFECTS_UNCLASSIFIED` until the user explicitly includes or discards those files.

Each include/discard receipt is bound to the exact final-test audit that produced it. Retrying the same blocked generation or integration step reuses that decision, but a fresh final-test attempt after Manual QA fixes must produce its own decision; an older round's override cannot resolve newly unclassified files.

### 1.5 Optional Manual QA route

`TESTS_PASSED` branches on the value frozen when the ticket started. Disabled or missing locks keep the direct integration path. Enabled tickets enter:

```text
RUNNING_FINAL_TEST → GENERATING_QA_CHECKLIST → WAITING_MANUAL_QA
  pass / waive / skip → INTEGRATING_CHANGES
  any fail → CODING → fresh RUNNING_FINAL_TEST → next Manual QA version
```

#### `GENERATING_QA_CHECKLIST`

“LoopTroop is preparing a human-facing Manual QA checklist from approved context and focused implementation evidence, with generation status, logs, and the produced checklist artifact available in the phase workspace.”

No user action is needed. LoopTroop first resolves the current final-test audit, commits accepted candidate effects into a dedicated local checkpoint, quarantines ticket-owned temporary/unexpected or prior residue, and records HEAD/status/file signatures. Generation requires a clean Git-visible worktree so the first QA-fix bead cannot accidentally commit test or application-runtime residue.

Before the model call, `vN` is reserved and projected immediately. A restart or retry reuses that incomplete version even if the checklist was already written; valid checklist/coverage files advance without another call, and a missing deterministic coverage file is rebuilt from the frozen PRD. The locked main implementer and variant receive the ticket title and description, frozen approved PRD, selected bead fields (including verification intent, labels, and issue type), the current final-test report, latest previous checklist/results/coverage/summary, and targeted metadata for the complete merge-base-to-checkpoint candidate range. Focused read-only diff inspection is allowed; whole-repository dumps are not.

One strict tagged YAML response supplies each short item title, checklist content, and `full | partial` PRD references. Checklist items use `prd | bead | previous_qa | implementation_diff` sources, `required | optional` severity, and `new | pending_recheck | previously_passed` recheck state; requiredness is not duplicated in a second boolean. Formatting repairs may normalize envelopes, YAML syntax, or known aliases, but never invent behavior, actions, observations, or expected results. Invalid criterion refs and invalid later-round lineage/recheck relationships fail validation and use normal structured retries. LoopTroop derives refs as `<epic-id>/<story-id>/AC-<1-based-index>` and computes coverage plus checklist source-category counts in code: any valid full ref covers a criterion, partial-only refs make it partially covered, and no valid refs leave it uncovered. Gaps are advisory.

The preparation workspace mirrors other artifact-producing phases: it shows a concise live status, exposes the exact `manual_qa_checklist` artifact in a clickable viewer as soon as it is persisted, and keeps the phase log available. It does not mount the result-entry form or query a merely reserved version before handoff; the following status owns those interactions.

#### `WAITING_MANUAL_QA`

“LoopTroop is waiting in the interactive Manual QA workspace for the user to record results and evidence, then complete, waive, skip, or submit the checklist before final integration.”

The user—not LoopTroop—starts and controls the application, follows prerequisites/actions, and records results. Every item offers Pass, Fail, Waive, and Improvement; required items cannot remain Pending, while optional items may. Any Fail blocks integration, including an optional item, and requires an observation. Waive requires a reason; Pass notes are optional. Improvements are non-blocking, require a reviewed title/description/context, and each produces exactly one Normal-priority Draft ticket in the same project on final Submit.

The five-second autosave uses compare-and-set `ui_state:manual_qa_draft:vN`, while final Submit snapshots it as immutable `manual_qa_draft`. Evidence may be any file type up to 250 MiB per file, with no count/round cap. Uploads are streamed into contained temporary files, hashed and size-checked, then atomically renamed; only safe rasters preview inline. Links must be HTTP(S), and binaries remain disk-only.

Before Submit or Skip, the worktree is compared with the QA baseline. If running the app caused drift, the gate stays open until the user includes exactly audited files in a checkpoint or discards exactly those changes. Submission then uses an operation-typed journal with deterministic origins/action IDs so partial restarts cannot switch Submit into Skip, change the frozen draft, overwrite immutable results, or duplicate beads/improvement tickets. Submit promotes the frozen draft to `manual_qa_results`; Skip instead preserves the immutable draft plus skip receipt and summary, because no result submission occurred. A durable final summary repairs an incomplete journal and any missing compact summary/skip-receipt phase mirrors before replaying the workflow transition.

Each completed round records start/completion time, duration, result/required/optional/evidence counts, waiver reasons, created work, next workflow action, coverage totals, and the immutable evidence-model capability snapshot. `.ticket/manual-qa/events.jsonl` provides the append-only generation-to-completion audit stream. Improvement ticket descriptions retain the user-edited text first and append editable human-readable context, including concise PRD requirements, bead work areas, and evidence summaries when available; ticket/version/item IDs, hashes, evidence paths, and receipt data stay in the structured origin metadata. The origin-to-child mapping is transactionally reserved in SQLite, allowing a restart to repair child evidence and provenance even if it stopped immediately after child creation.

Final integration and PR delivery use the newest completed round for the outcome, waiver, and skip state, while accumulating every created QA-fix bead ID and improvement-ticket ID across earlier rounds. This keeps work created by a failed v1 visible after a later v2 passes, without putting evidence binaries into delivery context.

Outcomes are:

- `passed`: no failures and no required waivers; continue to integration.
- `waived_through`: required items were explicitly waived; continue to integration.
- `skipped`: archive the partial draft and optional reason, create no drafted work, continue to integration.
- `created_fixes`: create grouped or individual `qa-fix` beads plus all submitted improvement tickets, archive the round attempts, and return to Coding.

Later checklists preserve lineage and relevant structure. Fixed/failed or affected passed/waived items become `pending_recheck`; unaffected passed items may remain visible as `previously_passed`, while unaffected waivers remain only in history. New items are limited to newly affected user-facing behavior.

---

## 2. Two separate audits happen here

The current implementation uses **two different audit layers**, and they solve different problems:

| Audit | Status | Decisions | Scope |
| --- | --- | --- | --- |
| **Final-test file effects audit** | `RUNNING_FINAL_TEST` -> `INTEGRATING_CHANGES` | `candidate`, `temporary`, `unexpected`, plus possible `unclassified` leftovers | Only files produced or changed by final testing |
| **Candidate file audit** | `CREATING_PULL_REQUEST` | `include`, `exclude`, `review` | The entire final diff that would be pushed in the PR |

This distinction matters: the first audit controls which final-test byproducts are allowed into integration, while the second audit can still trim unrelated files from the candidate commit before the remote branch is updated.

---

## 3. `INTEGRATING_CHANGES`: building the local candidate commit

Integration is a deterministic git phase. It does not ask the model to rediscover scope.

### 3.1 Final-test audit gate first

Before creating a candidate commit, LoopTroop resolves the latest `final_test_file_effects_audit` and any user override. If unclassified final-test files still exist and no override is present, integration blocks immediately instead of guessing.

### 3.2 Squashing bead history into one candidate

Once the final-test audit is clear, LoopTroop:

1. resolves the merge base and pre-squash head
2. soft-resets the ticket branch back to the merge base
3. stages the allowed candidate files
4. creates one local squash commit that represents the whole ticket

The resulting `integration_report` is the handoff contract for PR creation. It records the candidate SHA, merge base, pre-squash head, commit count, completion time, and whether remote push is still deferred.

### 3.3 What integration intentionally does **not** do

At the end of `INTEGRATING_CHANGES`, the candidate commit is still **local**. The branch push and PR creation happen only in the next phase.

---

## 4. `CREATING_PULL_REQUEST`: final diff audit and draft PR creation

This phase is the GitHub handoff. It is also the last automated chance to remove unrelated byproducts from the delivery diff.

### 4.1 Candidate file audit before any push

LoopTroop first runs a model-driven candidate-file audit over the final diff. Every changed file must be classified exactly once as:

- `include`
- `exclude`
- `review`

If the audit excludes files, LoopTroop rewrites the local candidate commit from the merge base using only the included and reviewed files, updates the integration handoff SHA, and stores:

- `candidate_file_audit`
- `candidate_diff`

If audit parsing fails, LoopTroop falls back to **including all changed files**. Malformed audit output cannot silently drop files from the PR.

### 4.2 Drafting the PR body

Only after the candidate audit is settled does LoopTroop ask the locked main implementer to draft the PR title and body. PR drafting uses:

- ticket details
- PRD context
- the integration report
- the final test report
- diff stat
- diff name/status
- diff patch

The response must match a strict YAML schema. Structured retries happen before any remote git or GitHub side effects. If parsing still fails, LoopTroop records diagnostics and falls back to a deterministic PR title/body instead of blocking the ticket on prose formatting.

### 4.3 Push and PR upsert

After the candidate audit and PR draft are ready, LoopTroop:

1. force-pushes the candidate SHA to the remote ticket branch using `--force-with-lease`
2. creates a new draft PR, or updates the existing PR for that branch
3. persists PR metadata in `pull_request_report`

The stored PR report includes the PR URL, number, state, title, body, head SHA, timestamps, and the candidate-file audit summary that produced the final diff.

### 4.4 Failure safety

Git push and GitHub-side failures are not retried blindly. Instead, LoopTroop preserves the local candidate state and writes a `git_recovery_receipt` that records the failing step and the known-safe recovery context.

---

## 5. `WAITING_PR_REVIEW`: human merge or finish gate

Once the draft PR exists, automation pauses. The UI surfaces the reviewer-facing end state:

- the PR URL and metadata
- the candidate SHA and branch/base refs
- the final net diff
- the candidate-file audit
- the integration summary
- the final-test summary

### 5.1 Merge path

If the user chooses merge, LoopTroop marks the PR ready when needed, merges it on GitHub, verifies that the remote base branch now contains the candidate commit, and then records a `merge_report`. The local checkout is left untouched. Remote branch deletion after a successful merge is best-effort and any warning is preserved in the report.

### 5.2 Finish-without-merge path

If the user chooses the non-merge finish path (`close_unmerged` in the workflow actions), LoopTroop records `disposition: closed_unmerged` in `merge_report` and proceeds to cleanup **without** modifying the remote PR or the remote ticket branch.

> [!IMPORTANT]
> The current implementation does **not** auto-close or delete the PR on the `close_unmerged` path. It finishes the ticket locally while leaving the draft PR and branch untouched for later manual handling.

### 5.3 External merge detection

If the PR is merged manually on GitHub while `WAITING_PR_REVIEW` is open, LoopTroop detects that state, skips a duplicate merge call, verifies the remote base branch, and continues automatically.

---

## 6. `CLEANING_ENV`: remove runtime state, keep the evidence

Cleanup removes transient runtime resources while preserving the artifacts needed for audit and historical review.

### 6.1 What cleanup removes

The cleanup phase deletes transient runtime paths when present, including:

- `.ticket/runtime/locks`
- `.ticket/runtime/sessions`
- `.ticket/runtime/streams`
- `.ticket/runtime/tmp`
- `.ticket/runtime/state.yaml`
- the execution-setup runtime directory under `.ticket/runtime/execution-setup/**`
- `.ticket/runtime/execution-setup-profile.json`

### 6.2 What cleanup preserves

Cleanup keeps the planning and audit trail intact. In the worktree it preserves core planning files such as:

- `.ticket/meta/ticket.meta.json`
- `.ticket/interview.yaml`
- `.ticket/prd.yaml`
- `.ticket/relevant-files.yaml`
- the beads artifact
- execution logs under `.ticket/runtime/execution-log*.jsonl`

Ticket artifacts such as `final_test_report`, `integration_report`, `pull_request_report`, `merge_report`, and `cleanup_report` also remain available through the normal ticket storage and UI.

### 6.3 Cleanup warnings are visible, not fatal

Cleanup writes a `cleanup_report` with `status: clean` or `status: warning`. A warning means some transient path could not be removed, but the ticket still completes successfully and the warning stays visible for later housekeeping.

---

## 7. Key post-implementation artifacts

| Artifact | Produced in | Purpose |
| --- | --- | --- |
| `final_test_report` | `RUNNING_FINAL_TEST` | Canonical record of the generated test plan, command results, retries, and validation outcome |
| `final_test_retry_notes` | `RUNNING_FINAL_TEST` | Notes passed into later final-test attempts after failures |
| `final_test_file_effects_audit` | `RUNNING_FINAL_TEST` | Audit of files produced or changed by the passing final-test attempt |
| `final_test_file_effects_override` | `INTEGRATING_CHANGES` | Explicit user decision to include or discard unresolved final-test byproducts |
| `manual_qa_checklist` / `manual_qa_coverage` | `GENERATING_QA_CHECKLIST` | Versioned instructions and advisory approved-PRD coverage |
| `manual_qa_draft` / `manual_qa_results` / `manual_qa_summary` | `WAITING_MANUAL_QA` | Immutable action snapshot and outcome; `manual_qa_results` is present only after Submit, not Skip |
| Manual QA reservation/baseline/drift/submission receipts | Both Manual QA statuses | Restart idempotency, clean-workspace proof, and include/discard/create audit |
| `integration_report` | `INTEGRATING_CHANGES` | Candidate commit metadata used by PR creation |
| `candidate_file_audit` | `CREATING_PULL_REQUEST` | Include/exclude/review decisions for the final diff before push |
| `candidate_diff` | `CREATING_PULL_REQUEST` | Net diff for the final candidate after any audit rewrite |
| `pull_request_report` | `CREATING_PULL_REQUEST` | Stored PR metadata and generated title/body |
| `merge_report` | `WAITING_PR_REVIEW` | Completion outcome for merged vs finished-without-merge |
| `cleanup_report` | `CLEANING_ENV` | Removed/preserved runtime resources plus warning state |

---

## Related Docs

- [Pre-Implementation](pre-implementation.md)
- [Beads & Execution](beads.md)
- [Ticket Flow & State Machine](ticket-flow.md)
- [System Architecture](system-architecture.md)
