import { describe, expect, it } from 'vitest'
import { parseExecutionSetupPlanContent, serializeExecutionSetupPlan } from '../executionSetupPlan'

describe('execution setup workspace verification contract', () => {
  it('parses aliases and round-trips workspace inputs, probes, and Git hook configuration', () => {
    const parsed = parseExecutionSetupPlanContent(JSON.stringify({
      schema_version: 2,
      ticket_id: 'TEST-1',
      artifact: 'execution_setup_plan',
      status: 'draft',
      summary: 'Workspace input required.',
      readiness: {
        status: 'partial',
        actions_required: true,
        evidence: ['The original checkout contains the required fixture directory.'],
        gaps: ['The ticket worktree does not contain the fixture directory.'],
      },
      temp_roots: [],
      workspace_inputs: [{
        path: 'fixtures/local',
        kind: 'directory',
        source_status: 'untracked',
        reason: 'The workspace tests require local generated fixtures.',
      }],
      workspace_probes: [{ id: 'workspace', command: 'project test --list', purpose: 'Load the workspace.' }],
      git_hooks: {
        policy: 'validate_explicitly',
        detected: [{ name: 'pre-commit', path: '.husky/pre-commit', source: 'husky', executable: true, manager_hint: 'husky' }],
        validation_commands: [{ id: 'check', hook: 'pre-commit', command: 'project check', purpose: 'Validate commit.' }],
      },
      steps: [],
      project_commands: { prepare: [], test_full: [], lint_full: [], typecheck_full: [] },
      quality_gate_policy: { tests: '', lint: '', typecheck: '', full_project_fallback: '' },
      cautions: [],
    }))

    expect(parsed.error).toBeNull()
    expect(parsed.plan?.workspaceProbes.at(0)?.command).toBe('project test --list')
    expect(parsed.plan?.workspaceInputs).toEqual([{
      path: 'fixtures/local',
      kind: 'directory',
      sourceStatus: 'untracked',
      reason: 'The workspace tests require local generated fixtures.',
    }])
    expect(parsed.plan?.gitHooks.detected.at(0)?.managerHint).toBe('husky')
    expect(parsed.plan?.gitHooks.validationCommands.at(0)?.command).toBe('project check')

    const serialized = JSON.parse(serializeExecutionSetupPlan(parsed.plan!))
    expect(serialized.git_hooks.policy).toBe('validate_explicitly')
    expect(serialized.git_hooks.validation_commands).toHaveLength(1)
    expect(serialized.workspace_probes).toHaveLength(1)
    expect(serialized.workspace_inputs).toEqual([{
      path: 'fixtures/local',
      kind: 'directory',
      source_status: 'untracked',
      reason: 'The workspace tests require local generated fixtures.',
    }])
  })
})
