// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Deterministic verify-before-done (P1) — run configured project checks
 * (lint/test) after an agent run, before critic / complete.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface VerifyCommand {
  /** Short label for feedback (e.g. "unit-tests") */
  name: string
  /** Program to run without a shell */
  command: string
  args?: string[]
  /** Timeout ms (default 120_000) */
  timeoutMs?: number
}

export interface VerifyCommandResult {
  name: string
  command: string
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface VerifySuiteResult {
  ok: boolean
  results: VerifyCommandResult[]
  /** Human-readable summary for critic feedback */
  summary: string
  missing: string[]
}

const DEFAULT_MAX_OUTPUT = 8_000

function trimOut(s: string): string {
  if (s.length <= DEFAULT_MAX_OUTPUT) return s
  return s.slice(0, DEFAULT_MAX_OUTPUT) + `\n... [truncated]`
}

/**
 * Run verify commands sequentially in `cwd`. Empty list → ok with no work.
 */
export async function runVerifyCommands(
  commands: VerifyCommand[],
  cwd: string,
): Promise<VerifySuiteResult> {
  if (!commands.length) {
    return { ok: true, results: [], summary: 'No verify commands configured', missing: [] }
  }

  const results: VerifyCommandResult[] = []
  for (const cmd of commands) {
    const start = Date.now()
    try {
      const { stdout, stderr } = await execFileAsync(cmd.command, cmd.args ?? [], {
        cwd,
        timeout: cmd.timeoutMs ?? 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      })
      results.push({
        name: cmd.name,
        command: [cmd.command, ...(cmd.args ?? [])].join(' '),
        ok: true,
        exitCode: 0,
        stdout: trimOut(stdout ?? ''),
        stderr: trimOut(stderr ?? ''),
        durationMs: Date.now() - start,
      })
    } catch (err: any) {
      results.push({
        name: cmd.name,
        command: [cmd.command, ...(cmd.args ?? [])].join(' '),
        ok: false,
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        stdout: trimOut(err?.stdout?.toString?.() ?? ''),
        stderr: trimOut(err?.stderr?.toString?.() ?? err?.message ?? String(err)),
        durationMs: Date.now() - start,
      })
    }
  }

  const failed = results.filter((r) => !r.ok)
  const missing = failed.map((r) => `verify:${r.name} (exit ${r.exitCode})`)
  const summary = failed.length === 0
    ? `All ${results.length} verify command(s) passed`
    : `Verify failed: ${failed.map((r) => r.name).join(', ')}`

  return { ok: failed.length === 0, results, summary, missing }
}

/** Detect sensible defaults from a package.json-like marker in cwd — optional helper for docs. */
export const VERIFY_PRESETS = {
  bunTest: { name: 'bun-test', command: 'bun', args: ['test'] } satisfies VerifyCommand,
  tsc: { name: 'tsc', command: 'bunx', args: ['tsc', '--noEmit'] } satisfies VerifyCommand,
} as const
