# Post-Implementation: Verification & Delivery

After the bead coding loop is complete, LoopTroop enters the post-implementation stage. Instead of directly merging files, it executes a rigorous verification pass, filters the modified file list, packages the changes into a squashed git commit, and publishes the delivery pull request.

Post-implementation is split into five phases: **Testing** (`RUNNING_FINAL_TEST`), **Squashing Commits** (`INTEGRATING_CHANGES`), **Creating PR** (`CREATING_PULL_REQUEST`), **Reviewing PR** (`WAITING_PR_REVIEW`), and **Cleaning Up** (`CLEANING_ENV`).

---

## 1. Holistic Testing (`RUNNING_FINAL_TEST`)

Once all beads are marked `done`, LoopTroop does not assume the system compiles and works perfectly. It executes a comprehensive test plan.

### 1.1 Test Plan Generation
LoopTroop prompts the model with the ticket context, beads history, and implementation changes, using `PROM_FINAL_TEST_GENERATION`. The model produces a list of verification commands and acceptance cases.

### 1.2 Execution via Setup Wrappers
The test runner executes these commands sequentially inside the isolated worktree:
- It runs the commands using the validated environment wrappers (e.g., `env.sh` and wrapper commands) generated during the pre-implementation setup phase. This ensures that the tests run in the exact same environment that was approved.
- The results are parsed and stored in `.ticket/runtime/final-test-results.jsonl`.
- If a test fails, the system attempts bounded retries (governed by the `Final Test Retry Budget`). If it cannot resolve the failure, it routes the ticket to `BLOCKED_ERROR`.

---

## 2. File Effects Auditing (`INTEGRATING_CHANGES`)

LoopTroop performs a **File Effects Audit** to sanitize the changes before committing. This protects the repository from intermediate compiler outputs, cache files, or stray debug scripts.

Every file created or modified during the run is evaluated:
- **Include**: Core codebase modifications, new tests, and user-facing assets.
- **Exclude**: Temporary lockfiles, cached directories, and LoopTroop internal tracking files (like `.ticket/**` and `.looptroop/**`).
- **Review**: Borderline files that the user must review before inclusion.

Only files that pass the audit are staged for the final integration commit.

---

## 3. Integration & PR publishing (`CREATING_PULL_REQUEST` & `WAITING_PR_REVIEW`)

LoopTroop packages the verified changes into a clean delivery format:

### 3.1 Squashing Commits
During execution, every bead success is recorded as a local commit in the worktree. In the integration phase, LoopTroop squashes these granular bead-level commits into a single clean commit on a new target branch.

### 3.2 PR Creation & Description Drafting
LoopTroop pushes the target branch to the GitHub repository and drafts a pull request:
- It uses the main implementer model to write a detailed, user-facing PR title and description based on the actual code diff and implementation history.
- It invokes the GitHub API (via `gh` CLI) to publish the PR as a draft or a live PR.

### 3.3 The Review Gate
The ticket enters the `WAITING_PR_REVIEW` status. The dashboard pauses and provides:
- A link to the published GitHub Pull Request.
- An interactive UI panel showing the file differences.
- Controls to **Merge** (locks, runs final checks, and merges the PR) or **Close Unmerged** (closes the PR without merging).

---

## 4. Environment Cleanup (`CLEANING_ENV`)

After the PR review is completed (whether merged or closed), LoopTroop cleans up the temporary files:
- It deletes the local worktree checkouts if requested (controlled by the user cancellation/completion cleanup checkboxes).
- It removes transient lockfiles, OpenCode wrapper hooks, and session directories.
- It preserves planning artifacts, approvals, and logs under `.ticket/` for historical audit trails.
- The ticket is finally marked as `COMPLETED` or `CANCELED`.
