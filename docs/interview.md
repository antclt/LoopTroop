# Interview

> [!IMPORTANT]
> **TL;DR** — Before any code is planned, LoopTroop runs a council-drafted, adaptive interview that turns a vague ticket into concrete product and technical decisions. The approved interview artifact becomes the sole input for PRD generation — no chat history carries forward.

The interview is LoopTroop's ambiguity-removal stage. A ticket usually starts as a compact user request, but implementation often depends on decisions that are not written down yet: expected behavior, target users, constraints, edge cases, UI preferences, integration details, test expectations, and explicit non-goals.

LoopTroop handles those decisions before PRD drafting. The goal is not to create a long chat transcript. The goal is to produce a structured, reviewable interview artifact that later phases can trust without needing the full conversation history.

For the exact state-by-state mechanics, see [Ticket Flow - Interview](/ticket-flow#interview).

## Why It Exists

The interview prevents the coding pipeline from starting with vague intent. It turns a short ticket into concrete product and technical decisions while the cost of changing direction is still low.

This stage is especially important because later phases deliberately use narrow context. PRD drafting does not need every previous model attempt or conversation turn; it needs the approved interview artifact. That keeps downstream prompts focused on user-reviewed requirements instead of polluted by abandoned drafts or earlier execution attempts.

## Council Drafting

Interview planning starts with the LLM council. Each council member receives the ticket details and relevant-file scan, then independently drafts a candidate set of interview questions.

The drafts follow a three-part structure:

- Foundation: problem, target users, core value, constraints, non-goals, and anything out of scope.
- Structure: complete feature inventory, major user flows, priorities, and dependencies between expected behaviors.
- Assembly: feature-level behavior, edge cases, acceptance criteria, test intent, implementation constraints, and integration details.

The council votes on anonymized drafts using a structured rubric. The winning model then refines the selected draft, optionally incorporating stronger questions from losing drafts while preserving the winning structure. The result is compiled into the canonical interview session that the UI can render.

## Adaptive Question Batches

The user does not receive one large wall of questions. LoopTroop presents batches of 1 to 3 questions at a time.

Batch size is chosen dynamically:

- 1 question for complex, high-priority, or open-ended topics that need focused attention.
- 2 questions for moderately related topics or when previous answers were brief or unclear.
- 3 questions only for simple, factual, tightly related questions.

After each submitted batch, LoopTroop reviews the answers and adjusts only the remaining questions when needed. It can reorder, rephrase, merge, or lightly split compiled questions to make the next batch coherent. If an earlier answer fully resolves a later question, that later question can be marked as accounted for instead of asked redundantly.

The progress count is therefore an estimate. The current batch number is stable, but the total number of planned batches may change as answers make later questions unnecessary or reveal a targeted follow-up.

## Question Types

Interview questions can be free text, yes/no, single choice, or multiple choice. The prompt prefers structured question types when the answer space can be reasonably enumerated, because structured answers are easier to carry into PRD generation and later verification.

Choice questions still allow additional free-text notes. This means a user can select the closest option and add nuance when the options do not tell the full story.

Every question keeps an ID, phase, source, follow-up round, answer type, options when applicable, and answer state. Preserving IDs matters because later artifacts can trace requirements back to the exact interview question that produced them.

## Skipping Questions

Skipping is allowed and explicit. A skipped question is not silently removed, and it is not treated as if the user answered it.

Skipped questions remain in the interview artifact with `answer.skipped: true`. During PRD drafting, each council member may fill those skipped answers in its own Full Answers artifact before producing a PRD draft. Those AI-filled answers are marked `answered_by: ai_skip`, so they stay distinguishable from user-provided answers.

If the user chooses "skip all" for the remaining interview, LoopTroop marks the unanswered questions as skipped and advances directly to interview approval. It writes a synthetic clean coverage record for audit continuity, because the user explicitly chose to bypass the remaining coverage loop.

## Follow-Ups And Coverage

After the compiled interview has been answered, skipped, or rendered redundant, LoopTroop asks one final free-form question for anything else the user wants captured before PRD generation.

Then the winning interview model runs coverage. Coverage checks for:

- unresolved ambiguity
- missing constraints
- missing edge cases
- missing non-goals or out-of-scope boundaries
- inconsistent answers
- gaps that would force PRD drafting to guess

If coverage finds real gaps and the follow-up budget allows it, LoopTroop generates targeted follow-up questions and returns to the same answer state with a new batch. These follow-ups use coverage-specific IDs and are generated only for unresolved information that matters.

If coverage is clean, or the configured follow-up budget is exhausted, the interview advances to approval. Remaining gaps are preserved for review instead of hidden.

## Interview Artifact Structure

The final interview artifact is structured YAML, not a transcript. It includes:

- `schema_version`, `ticket_id`, `artifact`, and `status`
- `generated_by` metadata for the winning model and server canonicalization
- `questions` with IDs, phases, prompts, sources, follow-up rounds, answer types, options, and answers
- `follow_up_rounds` showing which questions came from prompt adaptation or coverage
- `summary` fields for goals, constraints, non-goals, and the final free-form answer
- `approval` metadata once the user approves the interview

Question sources can distinguish compiled questions, prompt follow-ups, coverage follow-ups, and the final free-form question. The session snapshot also tracks current batch state, batch history, answered/skipped/pending state, and completion time.

## Approval And Downstream Use

The interview pauses at approval before PRD generation starts. The user can review the structured or raw artifact, edit it if needed, and approve only the version they actually reviewed. Approval includes a content hash so stale browser tabs cannot approve a replaced artifact.

Once approved, the interview becomes the authoritative source for PRD drafting. The PRD phase uses it to create Full Answers artifacts, draft competing PRDs, and later check PRD coverage. Beads, implementation, and final verification are downstream of that PRD, so the interview is the first major place where user intent is made durable.

Post-approval interview edits are allowed only before pre-flight. Saving one archives the current approved interview and affected downstream PRD/beads planning attempts, then restarts PRD drafting from the edited interview.
