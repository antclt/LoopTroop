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

  it('keeps command execution timeout separate from model prompt timeout metadata', async () => {
    const report = await executeFinalTestCommands({
      commands: ['node -e "setTimeout(() => console.log(\'late\'), 200)"'],
      cwd: process.cwd(),
      timeoutMs: 25,
      plannedBy: 'test-vendor/test-model',
      modelOutput: '<FINAL_TEST_COMMANDS>{"commands":["node -e \\"setTimeout(() => console.log(\\\'late\\\'), 200)\\""]}</FINAL_TEST_COMMANDS>',
    })

    expect(report.passed).toBe(false)
    expect(report.commands[0]).toMatchObject({
      command: expect.stringContaining('setTimeout'),
      timedOut: true,
    })
    expect(report.errors[0]).toContain('Command timed out')
  })
})
