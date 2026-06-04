# Prompt Inventory

LoopTroop keeps model prompts in code and treats the TypeScript implementation as the source of truth. This page is a reference index: it lists the built-in prompt templates and runtime prompt builders, where each is used, and what each one is responsible for. It does not duplicate full prompt bodies.

## 1. Prompt Assembly Model

Named prompt templates live in `server/prompts/index.ts` and are exported through `ALL_PROMPTS`. Each template defines an ID, description, system role, task, instructions, expected output format, context inputs, and OpenCode tool policy.

The shared builders apply one of three rule blocks before sending a prompt:

| Builder | Rule block | Session type | Purpose |
| --- | --- | --- | --- |
| `buildPromptFromTemplate()` | `GLOBAL_RULES` | Fresh session | Tells the model that all needed context is in the current prompt. |
| `buildSameSessionPromptFromTemplate()` | `SAME_SESSION_RULES` | Existing session | Tells the model to use the current session history plus the provided context. |
| `buildConversationalPrompt()` | `CONVERSATIONAL_RULES` | Multi-turn session | Supports the interactive interview loop while preserving structured tag output. |

Context parts are assembled by `server/opencode/contextBuilder.ts`. See [Context Engineering](context-engineering.md) for the per-status context contract and why prompts receive only the smallest useful artifact slice.

## 2. Named Prompt Templates

These templates are exported from `server/prompts/index.ts` through `ALL_PROMPTS`.

| Prompt / builder | Source | Used in / status | Session type | Tool policy | Context inputs | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `PROM0` | `server/prompts/index.ts` | `SCANNING_RELEVANT_FILES` | Fresh | `default` | `ticket_details` | Inspects the repository and returns a structured relevant-files report with rationales and previews. |
| `PROM1` | `server/prompts/index.ts` | `COUNCIL_DELIBERATING` | Fresh council draft | `disabled` | `relevant_files`, `ticket_details` | Drafts candidate interview questions from ticket and repo context. |
| `PROM2` | `server/prompts/index.ts` | `COUNCIL_VOTING_INTERVIEW` | Fresh council vote | `disabled` | `relevant_files`, `ticket_details`, `drafts` | Scores interview drafts with the strict `draft_scores` YAML schema. |
| `PROM3` | `server/prompts/index.ts` | `COMPILING_INTERVIEW` | Fresh refinement | `disabled` | `relevant_files`, `ticket_details`, `drafts` | Refines the winning interview draft using selected improvements from alternatives. |
| `PROM4` | `server/prompts/index.ts` | `WAITING_INTERVIEW_ANSWERS` | Conversational | `disabled` | `ticket_details` | Runs the adaptive interview batch loop and returns tagged batch or completion artifacts. |
| `PROM5` | `server/prompts/index.ts` | `VERIFYING_INTERVIEW_COVERAGE` | Fresh coverage audit | `disabled` | `ticket_details`, `user_answers`, `interview` | Checks whether collected interview answers cover the ticket and can emit targeted follow-up questions. |
| `PROM10a` | `server/prompts/index.ts` | `DRAFTING_PRD` full-answers sub-step | Fresh | `disabled` | `relevant_files`, `ticket_details`, `interview` | Resolves skipped interview answers into a complete Full Answers artifact before PRD drafting. |
| `PROM10b` | `server/prompts/index.ts` | `DRAFTING_PRD` draft sub-step | Fresh council draft | `disabled` | `relevant_files`, `ticket_details`, `full_answers` | Drafts a structured PRD from the completed interview answers. |
| `PROM11` | `server/prompts/index.ts` | `COUNCIL_VOTING_PRD` | Fresh council vote | `disabled` | `relevant_files`, `ticket_details`, `interview`, `drafts` | Scores PRD drafts with the strict `draft_scores` YAML schema. |
| `PROM12` | `server/prompts/index.ts` | `REFINING_PRD` | Fresh refinement | `disabled` | `relevant_files`, `ticket_details`, `full_answers`, `drafts` | Refines the winning PRD draft and records machine-readable change metadata. |
| `PROM13` | `server/prompts/index.ts` | `VERIFYING_PRD_COVERAGE` | Fresh coverage audit | `disabled` | `full_answers`, `prd` | Compares the PRD against the adopted Full Answers artifact and reports concrete gaps. |
| `PROM13b` | `server/prompts/index.ts` | `VERIFYING_PRD_COVERAGE` revision sub-step | Fresh revision | `disabled` | `full_answers`, `prd`, `coverage_gaps` | Revises the PRD to resolve specific coverage gaps and records gap-resolution metadata. |
| `PROM20` | `server/prompts/index.ts` | `DRAFTING_BEADS` draft sub-step | Fresh council draft | `disabled` | `relevant_files`, `ticket_details`, `prd` | Drafts the semantic bead blueprint from the approved PRD. |
| `PROM21` | `server/prompts/index.ts` | `COUNCIL_VOTING_BEADS` | Fresh council vote | `disabled` | `relevant_files`, `ticket_details`, `prd`, `drafts` | Scores bead blueprints with the strict `draft_scores` YAML schema. |
| `PROM22` | `server/prompts/index.ts` | `REFINING_BEADS` | Fresh refinement | `disabled` | `relevant_files`, `ticket_details`, `prd`, `drafts`, `votes` | Refines the winning semantic bead blueprint using selected alternative-draft improvements. |
| `PROM23` | `server/prompts/index.ts` | `VERIFYING_BEADS_COVERAGE` | Fresh coverage audit | `disabled` | `prd`, `beads` | Checks whether the bead blueprint fully covers the PRD. |
| `PROM24` | `server/prompts/index.ts` | `VERIFYING_BEADS_COVERAGE` revision sub-step | Fresh revision | `disabled` | `prd`, `beads`, `coverage_gaps` | Revises the bead blueprint to address specific coverage gaps. |
| `PROM25` | `server/prompts/index.ts` | `EXPANDING_BEADS` | Fresh | `default` | `relevant_files`, `ticket_details`, `prd`, `beads_draft` | Expands the semantic blueprint into execution-ready bead records. |
| `PROM_EXECUTION_CAPABILITY_PROBE` | `server/prompts/index.ts` | `PRE_FLIGHT_CHECK` | Fresh probe | `read_only` | none | Runs a minimal OpenCode capability probe before execution setup. |
| `PROM_EXECUTION_SETUP_PLAN` | `server/prompts/index.ts` | `WAITING_EXECUTION_SETUP_APPROVAL` | Fresh planning | `read_only` | `ticket_details`, `relevant_files`, `prd`, `beads`, `execution_setup_profile`, `execution_setup_plan_notes` | Drafts a reviewable workspace setup plan without modifying the repository. |
| `PROM_EXECUTION_SETUP_PLAN_REGENERATE` | `server/prompts/index.ts` | `WAITING_EXECUTION_SETUP_APPROVAL` regeneration | Fresh planning | `read_only` | `ticket_details`, `relevant_files`, `prd`, `beads`, `execution_setup_profile`, `execution_setup_plan`, `execution_setup_plan_notes` | Revises the current setup plan using user commentary. |
| `PROM_EXECUTION_SETUP` | `server/prompts/index.ts` | `PREPARING_EXECUTION_ENV` | Fresh execution setup | `execution_setup_online` | `ticket_details`, `beads`, `execution_setup_plan`, `execution_setup_notes` | Executes the approved workspace setup plan and returns a structured setup result. |
| `PROM_EXECUTION_SETUP_NOTE` | `server/prompts/index.ts` | `PREPARING_EXECUTION_ENV` retry-note sub-step | Same session | `disabled` | `ticket_details`, `error_context` | Summarizes a failed runtime setup attempt for the next retry. |
| `PROM_CODING` | `server/prompts/index.ts` | `CODING` | Fresh bead implementation | `default` | `bead_data`, `bead_notes` | Guides the implementer through one bead and requires the bead completion marker. |
| `PROM51` | `server/prompts/index.ts` | `CODING` context-wipe sub-step | Same session | `disabled` | `bead_data`, `error_context` | Captures a compact failure note before abandoning a degraded bead session. |
| `PROM52` | `server/prompts/index.ts` | `RUNNING_FINAL_TEST` | Fresh final-test generation | `default` | `ticket_details`, `prd`, `beads`, `final_test_notes` | Adds or updates targeted final tests and returns the commands to run them. |
| `PROM53` | `server/prompts/index.ts` | `RUNNING_FINAL_TEST` retry-note sub-step | Fresh | `disabled` | `ticket_details`, `error_context` | Summarizes a failed final-test attempt for the next retry. |
| `PROM54` | `server/prompts/index.ts` | `BLOCKED_ERROR` continuation into preserved session | Same session | `default` | none | Sends the bare continuation text `continue please` into an eligible preserved OpenCode session. |

## 3. Runtime Prompt Builders

These builders assemble prompt variants around the named templates or create standalone operational prompts. They are intentionally documented as builder families because their exact text depends on runtime artifacts such as drafts, answers, diffs, validation errors, or command output.

| Prompt / builder | Source | Used in / status | Session type | Tool policy | Context inputs | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `buildInterviewVotePrompt()` | `server/workflow/phases/interviewPhase.ts` | `COUNCIL_VOTING_INTERVIEW` | Fresh council vote | `PROM2.toolPolicy` | `interview_vote` context plus `vote_rubric` | Adds the detailed interview voting rubric around `PROM2`. |
| `buildInterviewRefinePrompt()` | `server/workflow/phases/interviewPhase.ts` | `COMPILING_INTERVIEW` | Fresh refinement | `PROM3.toolPolicy` | `interview_refine` context with winning and losing drafts | Labels the winning interview draft and alternatives before `PROM3` refinement. |
| `startInterviewSession()` wrapper | `server/phases/interview/qa.ts` | `WAITING_INTERVIEW_ANSWERS` | Fresh conversational session | `PROM4.toolPolicy` | `interview_qa` context, compiled questions, interview limits | Starts the `PROM4` interview loop with configuration and the compiled question checklist. |
| `submitBatchToSession()` answer message | `server/phases/interview/qa.ts` | `WAITING_INTERVIEW_ANSWERS` | Same conversational session | `PROM4.toolPolicy` | User answers for the current batch | Sends user answers back into the active `PROM4` session and asks for the next batch or completion. |
| `buildInterviewResumePrompt()` | `server/phases/interview/qa.ts` | `WAITING_INTERVIEW_ANSWERS` restart path | Fresh conversational restart | `PROM4.toolPolicy` | `interview_qa` context plus normalized answered, skipped, and pending questions | Restarts a failed interview session without re-asking answered or skipped questions. |
| `PROM4` structured retry | `server/phases/interview/qa.ts` | `WAITING_INTERVIEW_ANSWERS` retry path | Same session when recoverable | `PROM4.toolPolicy` | Validation error, raw response, `PROM4` schema reminder | Corrects malformed interview batch or completion tags. |
| `buildPrdVotePrompt()` | `server/workflow/phases/prdPhase.ts` | `COUNCIL_VOTING_PRD` | Fresh council vote | `PROM11.toolPolicy` | `prd_vote` context plus `vote_rubric` | Adds the detailed PRD voting rubric around `PROM11`. |
| `buildPrdContextBuilder()` | `server/phases/prd/draft.ts` | `COUNCIL_VOTING_PRD`, `REFINING_PRD` | Fresh | `PROM11` or `PROM12` policy | `prd_vote` or `prd_refine` context | Supplies phase-specific PRD context to shared council vote/refine pipelines. |
| `buildPrdRefinePrompt()` | `server/phases/prd/draft.ts` | `REFINING_PRD` | Fresh refinement | `PROM12.toolPolicy` | Labeled Full Answers, winning PRD draft, alternative PRD drafts | Gives `PROM12` the exact winning draft and alternatives used for refinement. |
| `buildFullAnswersRetryPrompt()` | `server/phases/prd/draft.ts` | `DRAFTING_PRD` full-answers retry | Same session when recoverable | `PROM10a.toolPolicy` | Validation error, raw response, canonical interview, skipped IDs | Corrects malformed Full Answers output while preserving canonical question order and IDs. |
| `buildPrdRefinementRetryPrompt()` | `server/phases/prd/refined.ts` | `REFINING_PRD` retry path | Same session when recoverable | `PROM12.toolPolicy` | Validation error and sanitized raw response | Corrects malformed refined PRD output and reinforces PRD change metadata rules. |
| `buildPrdCoverageRevisionRetryPrompt()` | `server/phases/prd/coverageRevision.ts` | `VERIFYING_PRD_COVERAGE` revision retry | Same session when recoverable | `PROM13b.toolPolicy` | Validation error and sanitized raw response | Corrects malformed PRD coverage revision output, including `changes` and `gap_resolutions`. |
| `buildBeadsContextBuilder()` | `server/phases/beads/draft.ts` | `COUNCIL_VOTING_BEADS`, `REFINING_BEADS` | Fresh | `PROM21` or `PROM22` policy | `beads_vote` or `beads_refine` context | Supplies phase-specific bead context to shared council vote/refine pipelines. |
| `buildBeadsVotePrompt()` | `server/workflow/phases/beadsPhase.ts` | `COUNCIL_VOTING_BEADS` | Fresh council vote | `PROM21.toolPolicy` | `beads_vote` context plus `vote_rubric` | Adds the detailed beads voting rubric around `PROM21`. |
| `buildBeadsExpandRetryPrompt()` | `server/workflow/phases/beadsPhase.ts` | `EXPANDING_BEADS` retry path | Same session when recoverable | `PROM25.toolPolicy` | Validation error, raw response, `PROM25` schema reminder | Corrects malformed expanded bead output and adds preserved-field guidance when needed. |
| `buildBeadsRefinementRetryPrompt()` | `server/phases/beads/refined.ts` | Defined helper for `REFINING_BEADS` retry | Same session when wired | `PROM22.toolPolicy` | Validation error and sanitized raw response | Corrects malformed refined bead output and reinforces bead change metadata rules; the current workflow path uses the generic council refinement retry. |
| `buildBeadsCoverageRevisionRetryPrompt()` | `server/phases/beads/coverageRevision.ts` | `VERIFYING_BEADS_COVERAGE` revision retry | Same session when recoverable | `PROM24.toolPolicy` | Validation error and sanitized raw response | Corrects malformed beads coverage revision output, including `changes` and `gap_resolutions`. |
| Execution setup plan structured retry | `server/phases/executionSetupPlan/generator.ts` | `WAITING_EXECUTION_SETUP_APPROVAL` retry path | Same session when recoverable, fresh session otherwise | Selected setup-plan template policy | Validation error, raw response, setup-plan schema reminder | Corrects malformed setup-plan or setup-plan-regeneration output. |
| Execution setup structured retry | `server/phases/executionSetup/generator.ts` | `PREPARING_EXECUTION_ENV` retry path | Same session when recoverable, fresh session otherwise | `PROM_EXECUTION_SETUP.toolPolicy` | Validation error, raw response, setup schema reminder | Corrects malformed workspace setup execution results. |
| `buildContinuationPrompt()` | `server/phases/execution/executor.ts` | `CODING` marker-repair path | Same bead session | `PROM_CODING.toolPolicy` | Bead ID, parse errors, previous response | Tells the implementer to continue the same bead attempt after a missing or invalid completion marker. |
| Bead completion structured retry | `server/phases/execution/executor.ts` | `CODING` marker-repair path | Same session when recoverable | `PROM_CODING.toolPolicy` | Validation error, raw response, bead-status schema reminder | Corrects malformed `<BEAD_STATUS>` completion markers. |
| Final-test structured retry | `server/phases/finalTest/generator.ts` | `RUNNING_FINAL_TEST` retry path | Same session when recoverable, fresh session otherwise | `PROM52.toolPolicy` | Validation error, raw response, final-test schema reminder | Corrects malformed `<FINAL_TEST_COMMANDS>` output. |
| `generateFinalTestRetryNote()` context wrapper | `server/workflow/phases/verificationPhase.ts` | `RUNNING_FINAL_TEST` retry-note sub-step | Fresh | `PROM53.toolPolicy` | `ticket_details`, generated `error_context` | Builds the final-test failure context passed into `PROM53`. |
| `buildCandidateFileAuditPrompt()` | `server/phases/integration/candidateFileAudit.ts` | `CREATING_PULL_REQUEST` audit sub-step | Fresh | `disabled` | Ticket context, integration report, final test report, final diff | Classifies changed files as include, exclude, or review before PR drafting. |
| `buildPullRequestPrompt()` | `server/workflow/phases/pullRequestPhase.ts` | `CREATING_PULL_REQUEST` PR draft sub-step | Fresh | `disabled` | `ticket_details`, `prd`, integration report, final test report, final diff | Drafts reviewer-friendly PR title and body fields from final candidate evidence. |
| Pull-request draft structured retry | `server/workflow/phases/pullRequestPhase.ts` | `CREATING_PULL_REQUEST` PR draft retry | Same session when recoverable, fresh session otherwise | `disabled` | Validation error, raw response, PR draft schema reminder | Corrects malformed PR draft YAML before falling back to deterministic PR text. |

## 4. Shared Structured Retry Prompts

Most structured-output failures use `buildStructuredRetryPrompt()` from `server/structuredOutput/yamlUtils.ts`. The shared retry prompt appends the validation error, an optional schema reminder, and the previous invalid response, then asks for only the corrected artifact.

Council draft retries have a local equivalent in `server/council/drafter.ts` because the draft pipeline owns its own normalized attempt loop. Council vote and refine retries use the shared helper unless a phase passes a stricter phase-specific retry builder such as `buildPrdRefinementRetryPrompt()`. A beads-specific refinement retry helper also exists, but the current `REFINING_BEADS` workflow path uses the generic council refinement retry.

Repairs must only correct formatting or structure. They should not invent requirements, answers, code changes, or missing user intent. See [Output Normalization](output-normalization.md) for parser repair rules, retry attempt storage, and Raw attempt diagnostics.

## 5. Maintenance Notes

When adding or changing a prompt:

1. Update the template description, detailed prompt text, output schema, and parser together.
2. Update this inventory with the prompt ID or builder, source path, workflow status, session type, tool policy, context inputs, and purpose.
3. Update [Context Engineering](context-engineering.md) if the prompt receives new context parts or changes status-level context behavior.
4. Update [Output Normalization](output-normalization.md) if the expected output shape, parser, repair rules, or retry behavior changes.

Prompt text can be inspected in live runs through raw attempt diagnostics when the phase stores an initial prompt. This page remains the stable docs index for which prompt families exist and where they are used.
