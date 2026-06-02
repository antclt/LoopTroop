# Core Philosophy

LoopTroop is opinionated about how AI coding systems should behave. The app trades speed and conversational convenience for controllability, recovery, and durable correctness.

## The Five Core Commitments

| Commitment | What it means in practice |
| --- | --- |
| Control context, do not accumulate it blindly | Every phase assembles only the artifacts it is allowed to see. It never inherits chat history or useless context from previous phases. |
| Compete before you converge | Interview, PRD, and bead planning use multi-model draft, vote, and refine |
| Keep humans at the irreversible boundaries | Interview, PRD, beads, and execution setup all have approval gates |
| Retry with fresh state, not with stale chat memory | Bead execution uses bounded Ralph-style retry loops with fresh context + notes from failures |
| Persist important state outside the model | Databases, logs, YAML, JSONL, and worktree artifacts outlive any single session |

## 1. Why LoopTroop Over Direct Agent Loops?

Direct coding-agent loops are highly useful, but they degrade rapidly when task complexity or repository scale increases. LoopTroop addresses the core challenges:

| Challenge | Direct Agent Behavior | LoopTroop's Fix |
| --- | --- | --- |
| **Flawed Planning** | A single model drafts a plan in one pass, missing edge cases | Multi-model councils draft, vote, refine, and verify |
| **Monolithic Overload** | Tries to solve a complex feature in one massive prompt | Decomposes work into atomic beads with acceptance criteria |
| **Single-Provider Bias** | One model's blind spots cascade through the whole pipeline | Cross-model councils harness diverse providers and architectures |
| **Context Rot** | Long chats suffer token bloat and degraded output | Phase-specific context rebuilt from durable artifacts each step |
| **Degenerate Retries** | Keeps fixing inside the same polluted session | Ralph-style fresh-session retries with compact failure notes |
| **Risky Edits** | Modifies your active checkout directly | Isolated git worktrees per ticket |
| **Opaque Execution** | State and notes lost inside chat history | SQLite state, JSONL logs, and `.ticket/**` YAML artifacts |

## 2. Context Degradation Is A Design Constraint

Long-context models are useful, but they are still vulnerable to positional bias and long-run context drift. Performance can drop severely when reaching just 40% of the maximum context window—excessive conversational history and irrelevant files overwhelm the model, leading to missing files, broken imports, and "AI slop." LoopTroop treats this as a systems problem, not as a prompt wording problem.

That leads to three hard rules:

1. Phase prompts are built from durable artifacts, not from inherited chat history.
2. A phase only sees the context keys it is explicitly allowed to see.
3. When a retry is needed, LoopTroop prefers a fresh session plus a compact post-mortem over continuing a polluted transcript.

See [Context Engineering](context-engineering.md) for the design model, status matrix, and implementation allowlists.

## 3. Council Instead Of Single-Draft Planning

LoopTroop uses a council because early planning quality dominates downstream execution quality.

The council pattern is:

1. Independent drafts from multiple models.
2. Structured voting over anonymized drafts.
3. Refinement by the selected winner.
4. Coverage verification before moving forward.

This is not a free-form model group chat. It is a constrained orchestration pattern designed to surface better alternatives before the system commits to one.

`LLM council` is a useful current label, but it is not a universal standard term. In LoopTroop it specifically means this draft-vote-refine pipeline, not any arbitrary multi-agent conversation. That overlaps with newer multi-model consensus work, but the workflow contract here is defined by the repo, not by a generic paper or product label.

See [LLM Council](llm-council.md).

## 4. Bounded Ralph-Style Retry

Execution work fails in two broad ways:

- the model produces the wrong code
- the model gets stuck in a bad loop while carrying broken context forward

LoopTroop addresses the second case with a bounded Ralph-style retry discipline:

1. Capture what failed in a context wipe note.
2. Reset the worktree back to the bead start snapshot.
3. Start a fresh session with the bead spec plus the wipe note.
4. Stop after the configured retry limit.

This keeps the learning signal while discarding the poisoned conversational state.

`Ralph-style retry` is also a current community term rather than a formal standard. LoopTroop uses the term narrowly: it means fresh-session retry with preserved failure context, not unlimited unattended looping.

See [Beads & Execution](beads.md).

## 5. Beads Are The Unit Of Execution Memory

LoopTroop does not hand a whole feature to one coding session and hope for the best. It decomposes the approved PRD into beads:

- small enough to execute in focused context
- rich enough to encode acceptance criteria, tests, files, and dependencies
- durable enough to survive retries, restarts, and review

Beads are both the execution plan and the execution memory layer. They define what gets worked on next, what blocks what, and what context is needed for each coding attempt.

See [Beads](beads.md).

## 6. Human Review Is Not An Afterthought

LoopTroop inserts explicit approval gates before the most expensive and hardest-to-reverse transitions:

- approve the interview before PRD generation
- approve the PRD before bead planning
- approve the beads before execution
- approve the execution setup plan before environment mutation and coding

This keeps the system honest. The model is allowed to move quickly inside a phase, but the human decides when the pipeline is good enough to cross into the next expensive stage.

## 7. Isolation Is Part Of Correctness

LoopTroop treats isolation as a correctness boundary, not just a convenience feature.

At the repository layer, it uses `git worktree` as the main execution primitive. That matters because the coding agent should work inside a ticket-owned workspace, not in your main checkout. Fresh worktrees make it possible to:

- keep the attached project checkout out of the execution blast radius
- reset a bead back to a known snapshot during retry
- preserve inspectable ticket artifacts beside the isolated code changes
- clean up temporary runtime state without confusing it with your normal working directory

At the host layer, unattended AI execution is safer in a disposable VM, cloud desktop, or similarly sandboxed environment. Worktrees protect the repo boundary, but they do not replace process isolation, filesystem policy, or host-level blast-radius reduction. If an agent can run commands for hours, the safer default is to give it a safe host to operate in.

See [System Architecture](system-architecture.md), [Beads & Execution](beads.md), and Git’s official [`git worktree`](https://git-scm.com/docs/git-worktree.html) documentation.

## 8. Durable State Beats Conversational Memory

LoopTroop stores meaningful workflow state in places that can be inspected, queried, and rebuilt:

- SQLite for ticket status, artifacts, attempts, sessions, and errors
- YAML and JSONL artifacts in `.ticket/**`
- execution logs in `.ticket/runtime/execution-log.jsonl`, `.ticket/runtime/execution-log.debug.jsonl`, and `.ticket/runtime/execution-log.ai.jsonl`
- worktree state tied to git snapshots and PR outcomes

If the process restarts, the system should recover from storage, not from a model trying to remember what happened.

## 9. What LoopTroop Optimizes For

LoopTroop is optimized for:

- mid-size and large feature work
- overnight or multi-hour runs
- traceable planning artifacts
- recoverable execution
- explicit delivery outcomes

It is not optimized for:

- one-shot trivial edits
- chat-first exploratory coding
- unbounded autonomous runs with no checkpoints
- cost-sensitive budgets where API token volume matters — orchestrating multi-model councils and long retry loops uses a high volume of tokens, though costs can be mitigated by leveraging subscription plans or free-tier providers in OpenCode

## Related Docs

- [Ticket Flow](ticket-flow.md)
- [System Architecture](system-architecture.md)
- [Context Engineering](context-engineering.md)
- [LLM Council](llm-council.md)
- [Beads & Execution](beads.md)
