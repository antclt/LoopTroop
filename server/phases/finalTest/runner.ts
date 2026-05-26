import type { StructuredOutputMetadata } from '../../structuredOutput/types'
import type { RawAttempt } from '../../council/types'
import type { FinalTestFileEffect } from './fileEffectsAudit'
import { runShellCommand, type ShellCommandResult } from '../../lib/shellCommand'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(
  bin: string,
  args: string[],
  result:
    | { ok: true; stdin?: string; stdout?: string; stderr?: string }
    | { ok: false; error: string; stdin?: string; stdout?: string; stderr?: string },
) {
  try {
    const { logCommand } = _require('../../log/commandLogger') as typeof import('../../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

export interface FinalTestCommandResult {
  command: string
  effectiveCommand?: string
  setupWrapperApplied?: boolean
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface FinalTestAttemptHistoryEntry {
  attempt: number
  status: 'passed' | 'failed'
  checkedAt: string
  summary?: string
  commands: string[]
  testFiles: string[]
  modifiedFiles: string[]
  fileEffects: FinalTestFileEffect[]
  errors: string[]
  failureReason?: string
  noteAppended?: string
}

export interface FinalTestExecutionReport {
  status: 'passed' | 'failed'
  passed: boolean
  checkedAt: string
  plannedBy: string
  summary?: string
  testFiles: string[]
  modifiedFiles: string[]
  fileEffects: FinalTestFileEffect[]
  testsCount: number | null
  modelOutput: string
  commands: FinalTestCommandResult[]
  errors: string[]
  planStructuredOutput?: StructuredOutputMetadata
  rawAttempts?: RawAttempt[]
  attempt?: number
  maxIterations?: number | null
  attemptHistory?: FinalTestAttemptHistoryEntry[]
  retryNotes?: string[]
}

function toFinalTestCommandResult(result: ShellCommandResult): FinalTestCommandResult {
  return {
    command: result.command,
    ...(result.effectiveCommand ? { effectiveCommand: result.effectiveCommand } : {}),
    ...(result.setupWrapperApplied ? { setupWrapperApplied: true } : {}),
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  }
}

export async function executeFinalTestCommands(input: {
  commands: string[]
  cwd: string
  timeoutMs?: number
  plannedBy: string
  summary?: string
  testFiles?: string[]
  modifiedFiles?: string[]
  fileEffects?: FinalTestFileEffect[]
  testsCount?: number | null
  modelOutput: string
  planStructuredOutput?: StructuredOutputMetadata
  rawAttempts?: RawAttempt[]
  setupEnvironment?: {
    commandWrapper?: string
  }
}): Promise<FinalTestExecutionReport> {
  const commandResults: FinalTestCommandResult[] = []
  const errors: string[] = []

  for (const command of input.commands) {
    const execution = await runShellCommand({
      command,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      commandWrapper: input.setupEnvironment?.commandWrapper,
    })
    const result = toFinalTestCommandResult(execution)
    commandResults.push(result)

    // Log the command execution to SYS
    if (result.exitCode === 0 && !result.timedOut) {
      logCmd(execution.bin, execution.args, {
        ok: true,
        stdout: result.stdout.trim() || undefined,
        stderr: result.stderr.trim() || undefined,
      })
    } else {
      const errDetail = result.timedOut
        ? `timed out after ${result.durationMs}ms`
        : `exit code ${result.exitCode ?? 'unknown'}`
      logCmd(execution.bin, execution.args, {
        ok: false,
        error: errDetail,
        stdout: result.stdout.trim() || undefined,
        stderr: result.stderr.trim() || undefined,
      })
    }

    if (result.exitCode !== 0 || result.timedOut) {
      errors.push(result.timedOut
        ? `Command timed out: ${command}`
        : `Command failed (${result.exitCode ?? 'no exit code'}): ${command}`)
      break
    }
  }

  const passed = errors.length === 0 && input.commands.length > 0
  return {
    status: passed ? 'passed' : 'failed',
    passed,
    checkedAt: new Date().toISOString(),
    plannedBy: input.plannedBy,
    summary: input.summary,
    testFiles: input.testFiles ?? [],
    modifiedFiles: input.modifiedFiles ?? input.testFiles ?? [],
    fileEffects: input.fileEffects ?? [],
    testsCount: input.testsCount ?? null,
    modelOutput: input.modelOutput,
    commands: commandResults,
    errors,
    ...(input.planStructuredOutput ? { planStructuredOutput: input.planStructuredOutput } : {}),
    ...(input.rawAttempts ? { rawAttempts: input.rawAttempts } : {}),
  }
}
