# PRD

> [!IMPORTANT]
> **TL;DR** — The PRD is a council-drafted implementation contract built from the approved interview. It defines scope, behavior, constraints, and acceptance criteria. Beads planning decomposes this spec — not the raw ticket — into executable work.

The PRD is the ticket's implementation contract. It turns the approved interview into a structured specification that later phases can decompose, verify, and trace back to user intent.

In LoopTroop, the PRD is practical rather than ceremonial. It defines what needs to be built, why it matters, what is in and out of scope, which technical constraints matter, what behavior must be accepted, and how the result should be verified.

For the exact state-by-state mechanics, see [Ticket Flow - PRD](/ticket-flow#prd).

## 1. Why It Exists

The PRD protects the workflow from a common AI coding failure mode: starting implementation from a vague request. It gives beads planning a concrete contract before any execution plan is created and before any code is written.

The PRD sits between the human interview and the implementation plan. It is broad enough to describe the whole ticket, but structured enough that beads can later split it into concrete work.

## 2. Full Answers

PRD drafting starts by resolving skipped interview questions. Before a council member writes a PRD, it creates a Full Answers artifact from the approved interview.

The Full Answers artifact preserves the approved interview structure:

- question order and IDs
- prompts and phases
- answer types and options
- source and follow-up metadata
- follow-up rounds
- summary and approval fields
- every non-skipped user answer exactly as provided

The only fields a model may change are the answer blocks for skipped questions. Filled answers are marked with `answered_by: ai_skip`, set `answer.skipped: false`, and include a concrete answer inferred from ticket details, relevant files, and the rest of the interview. For single-choice and multiple-choice questions, the model must use existing option IDs and may add concise free text when the selected option needs nuance.

If no skipped answers need filling, LoopTroop can synthesize the Full Answers artifact without a model call.

## 3. Why Full Answers Are Per-Model

Each council member creates its own Full Answers artifact. This is intentional.

Skipped questions often represent uncertain requirements. Different models may make different reasonable assumptions from the same ticket and repo context. Keeping Full Answers per model lets each PRD draft carry its own assumptions into voting, instead of forcing the entire council through one shared AI guess before drafting begins.

The winning model's Full Answers artifact is available read-only from PRD approval. It is supporting context that explains which user answers and AI-filled skipped answers shaped the winning PRD.

## 4. Council Drafting, Voting, And Refining

After Full Answers are prepared, each council member drafts an independent PRD from relevant files, ticket details, and its own Full Answers artifact. If a member cannot produce a valid Full Answers artifact, its PRD draft is not started; LoopTroop records a concise skipped/invalid diagnostic instead of letting malformed output become a draft.

The council then votes on anonymized PRD drafts using a requirements-focused rubric. The voting phase evaluates coverage, feasibility, testability, decomposition quality, risks, edge cases, acceptance criteria quality, and structural coherence.

The winning model refines its own draft by reviewing losing drafts for useful material. It can selectively adopt stronger requirements, acceptance criteria, edge cases, constraints, risks, and verification ideas. The goal is not to average every draft together. The goal is to keep the strongest baseline and improve it with clearly better pieces from competitors.

The refined result becomes PRD Candidate v1 and enters coverage.

## 5. PRD Structure

The PRD artifact is structured YAML with stable top-level sections:

- `schema_version`, `ticket_id`, `artifact`, and `status`
- `source_interview.content_sha256`
- `product.problem_statement` and `product.target_users`
- `scope.in_scope` and `scope.out_of_scope`
- `technical_requirements`
- `epics`
- `risks`
- `approval`

Technical requirements cover:

- architecture constraints
- data model
- API contracts
- security constraints
- performance constraints
- reliability constraints
- error-handling rules
- tooling assumptions

Each epic includes an ID, title, objective, implementation steps, and user stories. Each user story includes an ID, title, acceptance criteria, implementation steps, and `verification.required_commands`.

Every in-scope feature from the completed interview should map to at least one concrete user story. Acceptance criteria should be specific enough that later phases can verify whether the implementation satisfies them.

## 6. Coverage

Before approval, LoopTroop runs PRD coverage against the winning model's Full Answers artifact. This is the canonical source for PRD coverage because it contains the user-provided answers plus the winning model's adopted AI completions for skipped questions.

PRD coverage checks for:

- missing requirements
- vague or weak acceptance criteria
- missing edge cases
- missing constraints
- missing non-goals or out-of-scope items
- contradictions between the Full Answers artifact and the PRD
- weak verification guidance
- missing traceability from completed interview answers into the PRD

Unlike interview coverage, PRD coverage does not ask the user new questions. `follow_up_questions` is always empty for this phase. If gaps exist and the configured pass cap allows it, LoopTroop asks the model to revise the PRD in place, records change and gap-resolution metadata, validates the revised document, and audits the next candidate version.

If the coverage cap is reached with unresolved gaps, the latest candidate still advances to approval with warnings preserved. The user can then decide whether to edit the PRD manually before approving it.

## 7. Approval And Downstream Use

The PRD pauses at approval before beads planning begins. The user can review the structured or raw PRD, inspect unresolved coverage warnings, open the read-only Full Answers context for the winning model, edit the PRD if needed, and approve only the version they reviewed. Approval uses a content hash so stale tabs cannot approve replaced content.

Once approved, the PRD becomes the authoritative input for beads planning. Beads use it to create the execution blueprint and later expanded bead records. Implementation and verification then work from those approved beads, but the PRD remains the spec they should trace back to.

Post-approval PRD edits are allowed only before pre-flight. Saving one archives the current approved PRD and affected downstream beads planning attempts, then restarts beads drafting from the edited PRD.
