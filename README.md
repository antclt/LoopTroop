# LoopTroop

> **Local AI coding orchestration for repo-scale work.**
> LLM councils plan it. Ralph loops recover it. OpenCode worktrees ship it.

LoopTroop helps you turn a coding ticket into a planned, reviewable, agent-executed pull request.

Instead of relying on one long coding-agent chat, LoopTroop separates the work into clean stages: planning, approval, isolated execution, recovery, and final review. The planning path turns an interview into a PRD and then into small, manageable implementation units called "beads." The execution path runs those beads one at a time, with bounded retries that start from fresh context when an attempt fails.

| Architectural Layer |  Core | Technical Lifecycle |
| :--- | :--- | :--- |
| **1. Planning** | *LLM Councils Plan It* | Human Input ➔ AI Interview ➔ PRD ➔ Atomic Beads |
| **2. Execution** | *Ralph Loops Recover It* | Isolated Bead Work ➔ Bounded Testing, Repair, and Retry |
| **3. Shipping** | *OpenCode Worktrees Ship It* | Code Isolation ➔ Final Verification Pass ➔ PR Review Handoff |

**Start here:**
[Docs](https://www.looptroop.ovh/) |
[Getting Started](https://www.looptroop.ovh/getting-started) |
[Ticket Flow](https://www.looptroop.ovh/ticket-flow) |
[LLM Council](https://www.looptroop.ovh/llm-council) |
[Execution Loop](https://www.looptroop.ovh/execution-loop) |
[Changelog](https://www.looptroop.ovh/changelog)

---

## What is LoopTroop?

LoopTroop is a **local GUI orchestrator for long-running, high-correctness AI software delivery**, taking you from a raw idea to a PR-ready change set.

Unlike high-speed coding tools that optimize for immediate chat responses, LoopTroop is built for **complex, multi-file feature work** where alignment and correctness matter more than raw speed. It favors a slower, deliberate workflow that keeps requirements visible, asks for approval at major boundaries, and makes long-running execution inspectable.

**Context engineering reduces drift:** Traditional agent loops suffer from "context rot," where excessive conversation history, stale failures, and irrelevant files compete for the model's attention. LoopTroop uses **context engineering** to rebuild each prompt from durable artifacts and only the context needed for the active stage.

---

### Core Pipeline

LoopTroop breaks the development cycle into highly structured, verifiable phases:

1. **Interview Phase (AI-Generated and Tailored)**
    An interactive session gathers requirements and clarifies intent. Because matching your vision is the goal, this phase can take longer than a quick chat prompt by design.
2. **PRD Generation**
    Based on your interview, LoopTroop drafts a detailed Product Requirements Document (PRD) with epics, user stories, acceptance criteria, implementation steps, and verification guidance.
3. **Beads-Style Breakdown**
    Using the lightweight beads methodology, epics are split into small, independently implementable units of work. Each bead carries its own acceptance criteria, target files, dependencies, and validation plan.
4. **Council of LLMs (Drafting and Voting)**
    Interview output, PRDs, and bead plans are generated through a multi-model council. Several models draft independently, score proposals with a weighted rubric, and refine the strongest plan before execution begins.
5. **Execution via OpenCode and the Ralph Loop**
    Implementation is carried out by OpenCode in an isolated Git worktree. If a bead attempt fails, the Ralph-style retry loop captures a compact failure note, resets the worktree to a known point, and retries the bead in fresh context until it passes or the retry budget is exhausted. Complex tickets can take hours and are designed to run unattended in a safe environment.

---

### Context Engineering: Why This Exists

Context rot is the enemy of autonomous agents. When a model receives too much irrelevant or stale data, it can lose track of files, imports, constraints, and acceptance criteria.

LoopTroop solves this through explicit context contracts. Each prompt is rebuilt from durable ticket state, phase artifacts, bead data, setup profiles, compact retry notes, and validation guidance that are relevant to the current task. Keeping the working context fresh is what makes multi-hour, multi-step engineering cycles auditable and recoverable.

---

## Safety first: run it in a VM

LoopTroop is designed for serious agentic coding work. Because it can run unattended for hours, sitting at your computer to approve every terminal command is not practical.

For trusted local automation, the managed OpenCode server is permissive by default: LoopTroop starts it with `OPENCODE_PERMISSION='"allow"'` and creates execution sessions with allow-all tool permissions. This removes OpenCode approval prompts during automation.

While this makes long-running tasks possible, it introduces real risk. AI agents are not perfect. If a generation goes wrong, the agent can run commands that delete files, corrupt configuration, or break a workspace. Git worktrees isolate repository changes, but they do not sandbox host command execution. The agent still runs with your local user privileges.

**Recommended setup: run LoopTroop inside a disposable VM, cloud dev machine, or sandboxed development environment.**

Why:

- Git worktrees protect your attached repository checkout
- logs and artifacts help you inspect what happened
- a VM protects the rest of your computer

## How it works

```text
  [ 🎫 Ticket Input ]
          │
          ▼
   🔍 Codebase Discovery
          │
          ▼
   🏛️ LLM Council Planning (Interview, PRD & Beads)
          │
          ▼
   🛑 Human Approval Gates
          │
          ▼
   🧪 Isolated OpenCode Bead Execution (Git Worktree)
          ├─► [ 🔄 Ralph-Style Recovery Loop (On Failure) ]
          │
          ▼
   ✅ Final Tests & PR Review
```

LoopTroop keeps workflow state outside the model, stores durable artifacts, and asks for approval at important boundaries.

## Screenshots

![Projects dialog](docs/media/projects.png)
*Manage attached repositories, review ticket counts, and add new projects from the dashboard.*

![Configuration dialog](docs/media/configuration.png)
*Choose the main implementer model, council members, and effort levels for local orchestration.*

![Interview workspace](docs/media/interview.png)
*Answer focused planning questions before specs and implementation plans are approved.*

![Ticket workflow detail](docs/media/ticket.png)
*Track council progress, generated artifacts, and live execution logs inside a ticket.*

![Implementation review](docs/media/implementing.png)
*Review bead completion, commits, changes, and final implementation details before closing the workflow.*

![Bead execution detail](docs/media/bead.png)
*Inspect bead-level progress, task status, and live execution logs while an implementation bead runs.*

## Why not just use a coding agent directly?

Direct coding-agent loops are highly useful, but they degrade rapidly when task complexity or repository scale increases.

| Core Challenge | Direct Agent Behavior | LoopTroop's Structural Fix |
| :--- | :--- | :--- |
| **Flawed Planning** | A single model attempts to draft a multi-step plan in one pass, frequently missing structural edge cases. | **LLM Council Consensus:** Competing models draft, vote on, and synthesize a single, rigorous implementation plan. |
| **Monolithic Overload** | Direct agents try to solve a complex feature in a single massive prompt, leaving incomplete files or "TODO" placeholders. | **Atomic Bead Decomposition:** Breaks the feature into independent, test-backed beads so the agent can focus on one small change at a time. |
| **Single-Provider Bias** | Relying on one model makes your pipeline highly vulnerable to that specific model's logical blind spots and systemic failures. | **Cross-Model Councils:** Harnesses diverse providers and architectures (e.g., Anthropic, OpenAI, NVIDIA NIM) to critique and align code drafts. |
| **Context Rot** | Long-running chats suffer from token bloat and context degradation, leading to broken imports or forgotten criteria. | **Context Engineering:** The environment strictly isolates context, feeding the agent only the smallest useful context for each step. |
| **Degenerate Retries** | When a command fails, the agent tries to fix it within the same polluted chat session, compounding previous errors. | **Ralph-Style Retries:** Discards the broken chat session entirely and retries the exact bead with a fresh context window (plus notes from previous failures). |
| **Risky Edits** | Code modifications are made directly in your active checkout, potentially leaving your main branch in an unstable state. | **Isolated Git Worktrees:** Executes all changes in dedicated, isolated worktrees away from your primary working branch. |
| **Opaque Execution** | Internal states, planning notes, and test outputs are lost inside unstructured chat history. | **Structured Durability:** Maintains state locally inside SQLite, JSONL logs, and easily inspectable `.ticket/**` YAML artifacts. |

## Core ideas

### Context Engineering

To prevent LLM drift and performance degradation, LoopTroop feeds the model only the smallest useful context required for its active task. Instead of sending full conversational transcripts, the engine isolates payloads to the active status. This eliminates "context rot" and conversation pollution from previous execution attempts, keeping model focus high.

Read more: [Context Engineering](https://www.looptroop.ovh/context-engineering)

### LLM Council

The LLM Council is LoopTroop's planning system. Instead of relying on a single model run, LoopTroop orchestrates multiple independent model instances to **draft** plans, **vote** on proposals, and **refine** the winning draft with useful ideas from competing drafts. Coverage checks then verify the artifact before execution begins.

This multi-role system is used for:

- Interview questions
- PRD/spec generation
- Bead and blueprint generation

Read more: [LLM Council](https://www.looptroop.ovh/llm-council)

### Interview

Before writing a spec, the LLM Council compiles targeted questions to resolve ambiguity. You answer these questions in the Interview workspace to clarify edge cases, design decisions, and requirements, reducing the chance that later phases operate on false assumptions. The final interview artifact is created after drafting, voting, and refining are complete, but the UI still presents questions in adaptive batches that can change based on previous answers.

Read more: [Interview](https://www.looptroop.ovh/interview)

### PRD (Product Requirements Document)

Once the interview phase is complete, the LLM Council translates your initial ticket and interview answers into a structured Product Requirements Document. This spec serves as the implementation contract, detailing the technical approach, edge cases, scope, and expected validation steps before coding starts. The same draft, vote, refine, and coverage-check process applies here, and the PRD is stored as a durable artifact for later reference during bead execution.

Read more: [PRD](https://www.looptroop.ovh/prd)

### Beads

LoopTroop uses **the lightweight beads methodology**, not a dependency on the full external Beads project. It extracts the planning structure needed to bring immediate value to your repository.

A "bead" acts as a small, isolated implementation unit, allowing the execution agent to complete concrete tasks sequentially rather than attempting a massive, single-pass code rewrite. Each bead contains:

- Clear purpose and objective
- Measurable acceptance criteria
- Necessary dependencies and prerequisite context
- Specific target files
- Expected validation and testing steps

The LLM Council uses the same draft, vote, refine, and coverage-check pattern for bead planning.

Read more: [Beads](https://www.looptroop.ovh/beads)

### Ralph-style recovery

When an agent attempt fails, continuing the same conversation can make things worse. LoopTroop preserves a compact error trace from the failure, resets the worktree to a known point, discards the contaminated session, and begins a fresh run with clean context.

```text
fail ──> log failure trace ──> reset worktree ──> retry fresh
```

Read more: [Execution Loop](https://www.looptroop.ovh/execution-loop)

### Worktree isolation

LoopTroop runs execution steps inside isolated Git worktrees rather than modifying your active branch. This keeps your working copy clean and ensures reliable, inspectable diffs. Note that worktrees provide workspace isolation, not sandboxed host security.

Read more: [System Architecture](https://www.looptroop.ovh/system-architecture)

### Human approval gates

LoopTroop keeps you in control of critical state transitions. You actively review and sign off on planning specs, execution blueprints, workspace setup, and final pull request deliverables.

Read more: [Ticket Flow](https://www.looptroop.ovh/ticket-flow)

## Quick start

Use a VM or disposable development environment first.

```bash
git clone https://github.com/looptroop-ai/LoopTroop.git
cd LoopTroop
npm run dev
```

Open `http://localhost:5173`, add a local repository with a GitHub origin, create a ticket, and follow the review gates.

Full setup, ports, startup flags, and troubleshooting: [Getting Started](https://www.looptroop.ovh/getting-started) and [Operations Guide](https://www.looptroop.ovh/operations).

## What you need

LoopTroop expects:

- Node.js and npm
- git
- OpenCode installed locally with at least one configured model provider
- a local repository with a GitHub origin
- a VM or sandboxed dev environment for safer agent execution

## What LoopTroop is not

LoopTroop is not a magic autopilot. It does not remove the need to review code, inspect diffs, protect secrets, or run work in a safe environment. It is best understood as an orchestration layer around coding agents: planning, state, approvals, execution boundaries, retries, and delivery.

### What LoopTroop Is Not For

- **Cost-sensitive budgets:** Orchestrating multi-model councils and long retry loops can use a high volume of API tokens, though costs can be mitigated by using subscription plans through providers configured in OpenCode.
- **Urgent or quick fixes:** If you need a trivial change completed in seconds, LoopTroop's planning and approval overhead will feel slow.
- **Simple tasks:** For quick edits or trivial apps, standard IDE chat tools or tools like Replit, Bolt, or Lovable are better fits.

## Documentation

The README gives the first-glance overview. The full docs source lives in `docs/` and is published at:

https://www.looptroop.ovh/

Useful pages:

| Page | What it explains |
| --- | --- |
| [Getting Started](https://www.looptroop.ovh/getting-started) | Setup, startup, ports, first project attach |
| [Operations Guide](https://www.looptroop.ovh/operations) | Startup maintenance, environment variables, runtime storage, diagnostics, and cleanup |
| [Ticket Flow](https://www.looptroop.ovh/ticket-flow) | End-to-end workflow from ticket to PR result |
| [LLM Council](https://www.looptroop.ovh/llm-council) | Multi-model draft, vote, refine, and coverage planning |
| [Execution Loop](https://www.looptroop.ovh/execution-loop) | Bead execution, retries, resets, context wipe notes |
| [Beads](https://www.looptroop.ovh/beads) | The execution-unit model |
| [System Architecture](https://www.looptroop.ovh/system-architecture) | Runtime actors, storage, worktrees, artifacts |
| [OpenCode Integration](https://www.looptroop.ovh/opencode-integration) | Session ownership, reconnects, streaming, health checks |
| [FAQ](https://www.looptroop.ovh/faq) | Common questions and terminology |

When the app is running, the same docs are also available from the dashboard.

## Project status

LoopTroop is early alpha software, but it's usable for real work. Full ticket lifecycle is implemented, but expect some bugs. The core primitives (planning, execution, retries) are functional.

Roadmap: [Roadmap](https://www.looptroop.ovh/roadmap)

## Contributing

Contributions, ideas, bug reports, and workflow feedback are welcome.
