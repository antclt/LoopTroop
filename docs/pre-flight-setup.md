# Pre-Implementation: Pre-Flight & Setup

Before LoopTroop enters the coding execution stage, it runs a series of strict environment validation gates and sets up a localized execution container. This ensures that when the implementer starts coding, it has a clean workspace, access to the correct tools, and a reliable execution environment.

Pre-implementation is split into three phases: **Checking Readiness** (`PRE_FLIGHT_CHECK`), **Approving Setup** (`WAITING_EXECUTION_SETUP_APPROVAL`), and **Preparing Runtime** (`PREPARING_EXECUTION_ENV`).

---

## 1. Checking Readiness (`PRE_FLIGHT_CHECK`)

LoopTroop does not start writing code on an unverified workspace. When a ticket transitions out of the beads planning stage, it invokes the **Pre-Flight Doctor** (`server/phases/preflight/doctor.ts`) to run 19 automated integrity checks.

These checks are grouped into six main categories:

### 1.1 OpenCode & Model Connectivity
- **OpenCode Connectivity**: Verifies that the local OpenCode server is reachable.
- **Main Implementer Availability**: Queries the provider catalog to check if the locked main implementer model is online.
- **OpenCode Execution Capability**: Creates a temporary execution-mode session and runs a read-only probe prompt (`PROM_EXECUTION_CAPABILITY_PROBE`). It expects the model to reply exactly `OK` to ensure tool-calling and execution are functional.

### 1.2 Ticket & Planning Artifacts
- **Ticket Directory**: Confirms the workspace ticket directory `.ticket/` exists on disk.
- **Relevant Files**: Checks for the presence of the `relevant-files.yaml` index generated during discovery.
- **Beads Available**: Verifies that at least one bead has been planned for execution.
- **Beads Approval**: Confirms that the beads plan has a valid user approval receipt from the planning stage.

### 1.3 Dependency Graph Integrity
- **Dangling Dependencies**: Scans the bead list to make sure no bead blocks on a non-existent bead ID.
- **Self-Dependencies**: Verifies no bead is blocked by or blocks itself.
- **Duplicate Bead IDs**: Checks for duplicate identifiers in the planned beads list.
- **Circular Dependencies**: Traverses the dependency graph to ensure there are no circular blockers.
- **Runnable Bead Check**: Confirms the graph contains at least one bead with zero unsatisfied dependencies that can start immediately.

### 1.4 Git Safety & Cleanliness
- **Git Worktree presence**: Checks that the ticket's isolated Git worktree exists on disk.
- **HEAD State**: Verifies the worktree is active on a valid branch and not in a detached HEAD state.
- **Worktree Cleanliness**: Runs a workspace audit. If there are pre-existing, committable project changes outside LoopTroop's tracking paths, the check fails to prevent capturing unrelated edits in bead commits.

### 1.5 GitHub Integration
- **GitHub Origin Remote**: Checks that the repository remote resolves to `github.com`.
- **GitHub CLI Installation**: Verifies the `gh` binary is installed on the host system.
- **GitHub Auth Status**: Checks that the `gh` CLI is authenticated.
- **GitHub Repository Access**: Confirms that the authenticated CLI has read-write access to the remote target repository.

### 1.6 Concurrency & Budgets
- **Project Execution Lock**: Verifies no other ticket for the same project is currently in the execution band, avoiding Git conflicts.
- **Runtime Budget**: Validates that `maxIterations` is defined and non-negative.

> [!WARNING]
> Any check failing with a **Critical Failure** routes the ticket to `BLOCKED_ERROR`. Warnings (such as generated untracked noise files) are displayed but allow the pipeline to proceed.

---

## 2. Approving Setup (`WAITING_EXECUTION_SETUP_APPROVAL`)

Once pre-flight checks pass, LoopTroop drafts an environment setup blueprint. This step uses the main implementer model to decide what compilers, runtimes, package managers, and test suites are required.

### 2.1 The Setup Plan Draft
LoopTroop prompts the model with `PROM_EXECUTION_SETUP_PLAN`, feeding it the ticket details, relevant files, approved beads, PRD, and execution setup profiles. The model returns a structured `execution_setup_plan` containing:
- **`commands`**: Setup commands to run (e.g., `npm ci`, `pip install -r requirements.txt`).
- **`environment_variables`**: Key-value environment settings (e.g., `NODE_ENV: test`).
- **`tool_cache`**: User-space toolchains, dependencies, or package structures to provision locally.

### 2.2 Human Gate & Regeneration
The setup plan is presented to the user on the dashboard. The user has three choices:
1. **Direct Edit**: Modify the commands, variables, or YAML plan directly in the UI editor.
2. **Regenerate**: Provide natural-language comments (e.g., "Use Node 20 instead of Node 18") and trigger `PROM_EXECUTION_SETUP_PLAN_REGENERATE` to rewrite the plan.
3. **Approve**: Locks in the setup plan. Approval is content-hash protected to avoid stale-tab overrides.

---

## 3. Preparing Runtime (`PREPARING_EXECUTION_ENV`)

After user approval, the environment setup runner executes the plan steps sequentially.

```mermaid
flowchart TD
    A[Read Approved Setup Plan] --> B[Provision local Tool Cache]
    B --> C[Run Setup Commands]
    C --> D[Compile / Install deps]
    D --> E[Write env.sh & run wrappers]
    E --> F[Validate Wrapper Script]
    F --> G{Wrapper OK?}
    G -- Yes --> H[Ready for Coding]
    G -- No --> I[Setup Failure / BLOCKED_ERROR]
