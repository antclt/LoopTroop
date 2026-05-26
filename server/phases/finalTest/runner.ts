import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { FORCE_KILL_DELAY_MS } from '../../lib/constants'
import type { StructuredOutputMetadata } from '../../structuredOutput/types'
import type { RawAttempt } from '../../council/types'
import type { FinalTestFileEffect } from './fileEffectsAudit'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)
const MAX_COMMAND_OUTPUT_BYTES = 1_000_000

function getCommandShell(): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      bin: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c'],
    }
  }

  return {
    bin: existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh',
    args: [existsSync('/bin/bash') ? '-lc' : '-c'],
  }
}

function appendBoundedOutput(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= MAX_COMMAND_OUTPUT_BYTES) return current
  const text = chunk.toString()
  const remaining = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(current, 'utf8')
  const next = `${current}${text.slice(0, remaining)}`
  if (Buffer.byteLength(next, 'utf8') >= MAX_COMMAND_OUTPUT_BYTES) {
    return `${next}\n[LoopTroop truncated command output at ${MAX_COMMAND_OUTPUT_BYTES} bytes]`
  }
  return next
}

function terminateProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => undefined)
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

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

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<FinalTestCommandResult> {
  const startedAt = Date.now()
  return await new Promise<FinalTestCommandResult>((resolve) => {
    const shell = getCommandShell()
    const child = spawn(shell.bin, [...shell.args, command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve({
        command,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      })
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = appendBoundedOutput(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendBoundedOutput(stderr, chunk)
    })
    child.on('error', (error) => {
      stderr += error.message
      finish(null, null)
    })
    child.on('close', (exitCode, signal) => {
      finish(exitCode, signal)
    })

    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        terminateProcessTree(child, 'SIGTERM')
        setTimeout(() => terminateProcessTree(child, 'SIGKILL'), FORCE_KILL_DELAY_MS).unref()
      }, timeoutMs)
    }
  })
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
}): Promise<FinalTestExecutionReport> {
  const commandResults: FinalTestCommandResult[] = []
  const errors: string[] = []

  for (const command of input.commands) {
    const result = await runCommand(command, input.cwd, input.timeoutMs)
    const shell = getCommandShell()
    commandResults.push(result)

    // Log the command execution to SYS
    if (result.exitCode === 0 && !result.timedOut) {
      logCmd(shell.bin, [...shell.args, command], {
        ok: true,
        stdout: result.stdout.trim() || undefined,
        stderr: result.stderr.trim() || undefined,
      })
    } else {
      const errDetail = result.timedOut
        ? `timed out after ${result.durationMs}ms`
        : `exit code ${result.exitCode ?? 'unknown'}`
      logCmd(shell.bin, [...shell.args, command], {
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
