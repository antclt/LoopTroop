# Post-Implementation

After the bead coding loop is complete, LoopTroop enters the post-implementation stage. Instead of directly merging files, it executes a rigorous verification pass, filters the modified file list, packages the changes into a squashed git commit, and publishes the delivery pull request.

Post-implementation is split into five phases: **Testing** (`RUNNING_FINAL_TEST`), **Squashing Commits** (`INTEGRATING_CHANGES`), **Creating PR** (`CREATING_PULL_REQUEST`), **Reviewing PR** (`WAITING_PR_REVIEW`), and **Cleaning Up** (`CLEANING_ENV`).

---

## 1. Holistic Testing (`RUNNING_FINAL_TEST`)

Once all beads are marked `done`, LoopTroop does not assume the system compiles and works perfectly. It executes a comprehensive test plan to verify that the collective changes from all individual beads function cohesively.

### 1.1 Test Plan Generation
LoopTroop prompts the model with the ticket context, beads history, and implementation changes, using `PROM_FINAL_TEST_GENERATION`. The model produces a list of verification commands, shell scripts, and acceptance cases tailored to the specific feature that was implemented.

### 1.2 Execution via Setup Wrappers
The test runner executes these commands sequentially inside the isolated worktree:
- It runs the commands using the validated environment wrappers (e.g., `env.sh` and wrapper commands) generated during the pre-implementation setup phase. This ensures that the tests run in the exact same environment that was approved.
- The results are parsed and stored in `.ticket/runtime/final-test-results.jsonl`.
- If a test fails, the system attempts bounded retries (governed by the `Final Test Retry Budget`), passing the test errors back to the model for diagnosis and resolution. If it cannot resolve the failure within the budget, it routes the ticket to `BLOCKED_ERROR`.

---

## 2. File Effects Auditing (`INTEGRATING_CHANGES`)

LoopTroop performs a **File Effects Audit** to sanitize the changes before committing. This protects the repository from intermediate compiler outputs, cache files, stray debug scripts, or artifacts left behind during the Ralph loops.

Every file created or modified during the run is evaluated. The audit classifies files into three categories:

- **Include**: Core codebase modifications, new tests, documentation updates, and intended user-facing assets.
- **Exclude**: Temporary lockfiles, cached directories (like `node_modules` or `__pycache__`), and LoopTroop internal tracking files (like `.ticket/**` and `.looptroop/**`).
- **Review**: Borderline files that the audit is uncertain about. These files are flagged for explicit user review before inclusion.

Only files that explicitly pass the audit (or are manually approved via user override) are staged for the final integration commit. Files proven to be unintended side effects of testing are reverted or discarded.

### 2.1 Worktree Changes Classification

The audit uses a four-category classification system implemented in `server/git/worktreeChanges.ts`:

| Category | Meaning | Examples |
| --- | --- | --- |
| **committable** | Source code, new tests, documentation, intended assets | `.ts`, `.js`, `.css` files in `src/`, `test/` |
| **looptroopExcluded** | LoopTroop's own runtime state | `.looptroop/**`, `.ticket/**`, `.opencode/**` |
| **setupExcluded** | Environment setup byproducts declared in the execution setup plan | Declared `tempRoots`, tool-cache directories |
| **generatedNoise** | Unintended test/build outputs | `node_modules/`, `dist/`, `__pycache__/`, lockfiles in cache dirs |

`classifyWorktreePath()` determines the category for each changed path by checking against known exclusion patterns. `summarizeWorktreeChanges()` runs `git status` and returns a categorized `WorktreeChangeSummary` that the file effects audit uses to build the include/exclude/review decision list. `buildWorktreeDirtyError()` and `buildGeneratedNoiseWarning()` produce structured error/warning objects for the UI.

---

## 3. Integration & PR publishing (`CREATING_PULL_REQUEST` & `WAITING_PR_REVIEW`)

LoopTroop packages the verified changes into a clean delivery format:

### 3.1 Squashing Commits
During execution, every bead success is recorded as a local commit in the worktree. While this provides excellent granularity for rollbacks during development, it can clutter the project history. In the integration phase, LoopTroop squashes these granular bead-level commits into a single, clean commit on a new target branch.

### 3.2 PR Creation & Description Drafting
LoopTroop pushes the target branch to the GitHub repository and drafts a pull request:
- It uses the main implementer model to write a detailed, user-facing PR title and description based on the actual code diff and implementation history. The template merges Epic and User Story summaries from the PRD with a technical summary of the diff.
- It invokes the GitHub API (via `gh` CLI) to publish the PR as a draft or a live PR.

### 3.3 The Review Gate
The ticket enters the `WAITING_PR_REVIEW` status. The dashboard pauses and provides:
- A link to the published GitHub Pull Request.
- An interactive UI panel showing the file differences.
- Controls to **Merge** (which locks the branch, verifies the merge status on GitHub, and completes the workflow) or **Close Unmerged** (which closes the PR without merging).

---

## 4. Environment Cleanup (`CLEANING_ENV`)

After the PR review is completed (whether merged or closed), LoopTroop cleans up the temporary environment:

- **Worktree Removal**: It deletes the local worktree checkouts if requested (controlled by the user cancellation/completion cleanup checkboxes).
- **Session Cleanup**: It removes transient lockfiles, OpenCode wrapper hooks, and temporary `.opencode_sessions` directories.
- **Artifact Preservation**: It preserves planning artifacts (`.ticket/prd.yaml`, `.ticket/interview.yaml`), execution logs, and bead history under `.ticket/` for historical audit trails, ensuring that past decisions can be reviewed.
- The ticket is finally marked as `COMPLETED` or `CANCELED`.

---

## Related Docs

- [Ticket Flow & State Machine](ticket-flow.md)
- [Beads & Execution](beads.md)
