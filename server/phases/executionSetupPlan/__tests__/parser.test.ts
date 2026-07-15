import { describe, expect, it } from 'vitest'
import { parseExecutionSetupPlanResult } from '../parser'

function wrapPlan(body: string): string {
  return `<EXECUTION_SETUP_PLAN>\n${body}\n</EXECUTION_SETUP_PLAN>`
}

function buildPlanPayload(steps: unknown[]) {
  return {
    schema_version: 1,
    ticket_id: 'T-1',
    artifact: 'execution_setup_plan',
    status: 'draft',
    summary: 'Workspace needs setup before coding.',
    readiness: {
      status: 'partial',
      actions_required: true,
      evidence: ['Project manifest exists.'],
      gaps: ['Dependencies are missing.'],
    },
    temp_roots: ['.ticket/runtime/execution-setup'],
    workspace_probes: [{ id: 'workspace-1', command: 'project inspect', purpose: 'load the repository project' }],
    git_hooks: {
      policy: 'validate_explicitly',
      detected: [],
      validation_commands: [],
    },
    steps,
    project_commands: {
      prepare: ['project bootstrap'],
      test_full: ['project test'],
      lint_full: [],
      typecheck_full: [],
    },
    quality_gate_policy: {
      tests: 'bead-test-commands-first',
      lint: 'impacted-or-package',
      typecheck: 'impacted-or-package',
      full_project_fallback: 'never-block-on-unrelated-baseline',
    },
    cautions: [],
  }
}

function buildPlanWithSteps(steps: unknown[]): string {
  return wrapPlan(JSON.stringify(buildPlanPayload(steps)))
}

describe('parseExecutionSetupPlanResult', () => {
  it('repairs setup steps that omitted metadata fields but provided purpose text', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        order: 1,
        purpose: 'Install locked dependencies before running project-native tests.',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.workspaceProbes).toEqual([{ id: 'workspace-1', command: 'project inspect', purpose: 'load the repository project' }])
    expect(parsed.plan?.gitHooks.policy).toBe('validate_explicitly')
    expect(parsed.plan?.steps[0]).toMatchObject({
      id: 'setup-step-1',
      title: 'Install locked dependencies before running project-native tests.',
      purpose: 'Install locked dependencies before running project-native tests.',
      rationale: 'Install locked dependencies before running project-native tests.',
      commands: ['project bootstrap'],
      required: true,
      cautions: [],
    })
    expect(parsed.repairApplied).toBe(true)
    expect(parsed.repairWarnings).toEqual([
      'Filled missing execution setup plan step id at index 0 from list position.',
      'Filled missing execution setup plan step title at index 0 from existing purpose text.',
      'Filled missing execution setup plan step rationale at index 0 from existing purpose text.',
    ])
  })

  it('repairs the retry shape that has id but still omits title and rationale', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        id: 'step-1-bootstrap',
        purpose: 'Install locked dependencies before running project-native tests.',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.steps[0]).toMatchObject({
      id: 'step-1-bootstrap',
      title: 'Install locked dependencies before running project-native tests.',
      rationale: 'Install locked dependencies before running project-native tests.',
    })
    expect(parsed.repairWarnings).toEqual([
      'Filled missing execution setup plan step title at index 0 from existing purpose text.',
      'Filled missing execution setup plan step rationale at index 0 from existing purpose text.',
    ])
  })

  it('repairs execution_setup_plan wrapper objects around the payload', () => {
    const parsed = parseExecutionSetupPlanResult(wrapPlan(JSON.stringify({
      execution_setup_plan: buildPlanPayload([
        {
          id: 'step-1-bootstrap',
          purpose: 'Install locked dependencies before running project-native tests.',
          commands: ['project bootstrap'],
          required: true,
        },
      ]),
    })))

    expect(parsed.errors).toEqual([])
    expect(parsed.plan?.artifact).toBe('execution_setup_plan')
    expect(parsed.repairApplied).toBe(true)
    expect(parsed.repairWarnings).toContain('Removed wrapper key "execution_setup_plan" from top level.')
  })

  it('still rejects setup steps that do not provide purpose text', () => {
    const parsed = parseExecutionSetupPlanResult(buildPlanWithSteps([
      {
        id: 'step-1-bootstrap',
        title: 'Bootstrap project',
        commands: ['project bootstrap'],
        required: true,
      },
    ]))

    expect(parsed.plan).toBeNull()
    expect(parsed.errors).toEqual(['Missing required steps[0].purpose'])
  })
})
