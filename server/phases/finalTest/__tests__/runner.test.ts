import { describe, expect, it } from 'vitest'
import { executeFinalTestCommands } from '../runner'

describe('executeFinalTestCommands', () => {
  it('caps captured command output', async () => {
    const report = await executeFinalTestCommands({
      commands: ['node -e "process.stdout.write(\'x\'.repeat(1000100))"'],
      cwd: process.cwd(),
      plannedBy: 'test-vendor/test-model',
      modelOutput: '<FINAL_TEST_COMMANDS>{"commands":[]}</FINAL_TEST_COMMANDS>',
    })

    expect(report.commands[0]?.stdout.length).toBeLessThan(1_001_000)
    expect(report.commands[0]?.stdout).toContain('LoopTroop truncated command output')
  })
})
