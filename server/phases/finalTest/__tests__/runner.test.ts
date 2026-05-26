import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeFinalTestCommands } from '../runner'
import { quoteShellArg } from '../../../lib/shellCommand'

describe('executeFinalTestCommands', () => {
  function makeTempWorktree(): string {
    return mkdtempSync(join(tmpdir(), 'looptroop-final-test-runner-'))
  }

  function writeWrapper(worktree: string, body: string): string {
    const wrapperPath = join(worktree, '.ticket', 'runtime', 'execution-setup', 'run')
    mkdirSync(join(worktree, '.ticket', 'runtime', 'execution-setup'), { recursive: true })
    writeFileSync(wrapperPath, body)
    chmodSync(wrapperPath, 0o755)
    return wrapperPath
  }

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

  it('executes commands exactly as today when no setup wrapper exists', async () => {
    const command = `${quoteShellArg(process.execPath)} -e ${quoteShellArg("console.log('plain')")}`
    const report = await executeFinalTestCommands({
      commands: [command],
      cwd: process.cwd(),
      plannedBy: 'test-vendor/test-model',
      modelOutput: '<FINAL_TEST_COMMANDS>{"commands":[]}</FINAL_TEST_COMMANDS>',
    })

    expect(report.passed).toBe(true)
    expect(report.commands[0]).toMatchObject({
      command,
      stdout: expect.stringContaining('plain'),
    })
    expect(report.commands[0]?.effectiveCommand).toBeUndefined()
    expect(report.commands[0]?.setupWrapperApplied).toBeUndefined()
  })

  it('runs final-test commands through the declared setup wrapper', async () => {
    const worktree = makeTempWorktree()
    try {
      writeWrapper(worktree, '#!/usr/bin/env sh\nexport LOOP_FINAL_TEST_WRAPPER=1\nexec "$@"\n')
      const command = `${quoteShellArg(process.execPath)} -e ${quoteShellArg("if (process.env.LOOP_FINAL_TEST_WRAPPER !== '1') process.exit(7); console.log('wrapped')")}`

      const report = await executeFinalTestCommands({
        commands: [command],
        cwd: worktree,
        plannedBy: 'test-vendor/test-model',
        modelOutput: '<FINAL_TEST_COMMANDS>{"commands":[]}</FINAL_TEST_COMMANDS>',
        setupEnvironment: {
          commandWrapper: '.ticket/runtime/execution-setup/run',
        },
      })

      expect(report.passed).toBe(true)
      expect(report.commands[0]).toMatchObject({
        command,
        setupWrapperApplied: true,
        stdout: expect.stringContaining('wrapped'),
      })
      expect(report.commands[0]?.effectiveCommand).toContain('.ticket/runtime/execution-setup/run')
    } finally {
      rmSync(worktree, { recursive: true, force: true })
    }
  })

  it('does not double-wrap commands that already use the setup wrapper', async () => {
    const worktree = makeTempWorktree()
    try {
      writeWrapper(worktree, '#!/usr/bin/env sh\nexport LOOP_FINAL_TEST_WRAPPER=1\nexec "$@"\n')
      const command = `./.ticket/runtime/execution-setup/run ${quoteShellArg(process.execPath)} -e ${quoteShellArg("if (process.env.LOOP_FINAL_TEST_WRAPPER !== '1') process.exit(7); console.log('already wrapped')")}`

      const report = await executeFinalTestCommands({
        commands: [command],
        cwd: worktree,
        plannedBy: 'test-vendor/test-model',
        modelOutput: '<FINAL_TEST_COMMANDS>{"commands":[]}</FINAL_TEST_COMMANDS>',
        setupEnvironment: {
          commandWrapper: '.ticket/runtime/execution-setup/run',
        },
      })

      expect(report.passed).toBe(true)
      expect(report.commands[0]).toMatchObject({
        command,
        stdout: expect.stringContaining('already wrapped'),
      })
      expect(report.commands[0]?.effectiveCommand).toBeUndefined()
      expect(report.commands[0]?.setupWrapperApplied).toBeUndefined()
    } finally {
      rmSync(worktree, { recursive: true, force: true })
    }
  })

  it('fails clearly when the declared setup wrapper is missing', async () => {
    const worktree = makeTempWorktree()
    try {
      const command = `${quoteShellArg(process.execPath)} -e ${quoteShellArg("console.log('should not run')")}`

      const report = await executeFinalTestCommands({
        commands: [command],
        cwd: worktree,
        plannedBy: 'test-vendor/test-model',
        modelOutput: '<FINAL_TEST_COMMANDS>{"commands":[]}</FINAL_TEST_COMMANDS>',
        setupEnvironment: {
          commandWrapper: '.ticket/runtime/execution-setup/run',
        },
      })

      expect(report.passed).toBe(false)
      expect(report.commands[0]).toMatchObject({
        command,
        setupWrapperApplied: true,
        stderr: expect.stringContaining('was declared but does not exist'),
      })
      expect(report.commands[0]?.effectiveCommand).toContain('.ticket/runtime/execution-setup/run')
    } finally {
      rmSync(worktree, { recursive: true, force: true })
    }
  })
})
