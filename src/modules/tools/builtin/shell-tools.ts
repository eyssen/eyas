// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { ToolImplementation } from '../types.js'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_STREAM_BYTES = 1024 * 1024 // 1 MiB per stream (stdout/stderr)

/**
 * Shell metacharacters that enable command chaining, substitution, or
 * redirection. Raw command strings containing any of these are rejected when
 * shell-free execution is used. These are NOT escapes — they are hard
 * rejects, because the executor never hands input to a shell interpreter.
 */
const SHELL_METACHAR_DENYLIST = [';', '&&', '||', '|', '`', '$(', '$((', '>', '<', '\n', '\r']

function containsShellMetachars(s: string): { hit: true; token: string } | { hit: false } {
  for (const token of SHELL_METACHAR_DENYLIST) {
    if (s.includes(token)) return { hit: true, token }
  }
  return { hit: false }
}

const runCommandSchema = z.object({
  /**
   * Either a single program name (e.g. "ls") with `args` providing its
   * arguments, OR a full command string — but the command string MUST NOT
   * contain any shell metacharacters (it is executed without a shell).
   */
  command: z.string().min(1).max(4096),
  args: z.array(z.string().max(4096)).max(256).optional(),
  workingDir: z.string().max(4096).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  /** Optional stdin payload to write to the child process. */
  stdin: z.string().max(1024 * 1024).optional(),
})

export function createShellTools(_service: unknown): ToolImplementation[] {
  return [
    {
      name: 'run_command',
      description:
        'Execute a program without a shell interpreter. `command` is the program name (e.g. "ls"). `args` is an array of arguments. A single-string `command` containing shell metacharacters (; && || | ` $() > < newline) is rejected. Requires explicit user approval.',
      category: 'shell',
      riskTier: 'red',
      requiresApproval: true,
      sandboxMode: 'process',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Program to execute (no shell interpretation)' },
          args: { type: 'array', items: { type: 'string' }, description: 'Program arguments' },
          workingDir: { type: 'string', description: 'Working directory (default: project root)' },
          timeoutMs: { type: 'number', description: `Timeout in ms (default: ${DEFAULT_TIMEOUT_MS}, max 600000)` },
          stdin: { type: 'string', description: 'Optional stdin payload' },
        },
        required: ['command'],
      },
      validator: runCommandSchema,
      // Cast via `as any` on the function itself: the returned shape carries
      // extra fields (refused, exitCode, stdout/stderr) that ToolResult's
      // narrow type doesn't model. Callers read them off the loose object;
      // tightening ToolResult is tracked as tech debt.
      execute: (async (rawInput: Record<string, unknown>) => {
        // Input is already Zod-validated by the executor, but type it locally
        // for clarity.
        const input = rawInput as z.infer<typeof runCommandSchema>
        const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const cwd = input.workingDir ?? process.cwd()

        // Deny-list check: the raw command string must not contain shell
        // metacharacters. Even though we don't use a shell, this prevents
        // callers from smuggling e.g. "rm -rf /; echo ok" as `command`.
        const metaHit = containsShellMetachars(input.command)
        if (metaHit.hit) {
          return {
            exitCode: -1,
            stdout: '',
            stderr: `Refused: command contains shell metacharacter "${metaHit.token}". Use the args array instead of a shell pipeline.`,
            refused: true,
          }
        }
        for (const a of input.args ?? []) {
          const h = containsShellMetachars(a)
          if (h.hit) {
            return {
              exitCode: -1,
              stdout: '',
              stderr: `Refused: argument contains shell metacharacter "${h.token}".`,
              refused: true,
            }
          }
        }

        return await runShellFree({
          command: input.command,
          args: input.args ?? [],
          cwd,
          timeoutMs: timeout,
          stdin: input.stdin,
        })
      }) as any,
    },
  ]
}

interface RunOptions {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  stdin?: string
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  signal?: NodeJS.Signals | null
  timedOut?: boolean
  truncated?: boolean
}

/**
 * Run a program WITHOUT a shell, in its own process group so that on
 * timeout we can kill the entire subtree via `process.kill(-pid)`.
 *
 * Security properties:
 *  - No shell interpretation (argv is passed directly to `spawn`).
 *  - Detached process group → descendants killed on timeout.
 *  - Per-stream byte cap → unbounded producers can't OOM the host.
 *  - AbortController for clean cancellation.
 */
export async function runShellFree(opts: RunOptions): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const controller = new AbortController()
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // detached:true creates a new process group on POSIX so we can kill
      // the whole tree with process.kill(-pid). On Windows this is best-effort.
      detached: process.platform !== 'win32',
      signal: controller.signal,
      env: { ...process.env },
    })

    const finish = (r: RunResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }

    child.on('error', (err) => {
      finish({
        exitCode: -1,
        stdout,
        stderr: stderr + (stderr ? '\n' : '') + `spawn error: ${err.message}`,
        timedOut,
        truncated,
      })
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STREAM_BYTES) {
        if (!truncated) {
          stdout += chunk.slice(0, Math.max(0, MAX_STREAM_BYTES - (stdoutBytes - chunk.length))).toString('utf8')
          stdout += `\n... [truncated: stdout exceeded ${MAX_STREAM_BYTES} bytes]`
          truncated = true
        }
        // stop accumulating; still let the process finish so we exit cleanly
        return
      }
      stdout += chunk.toString('utf8')
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STREAM_BYTES) {
        if (!truncated) {
          stderr += chunk.slice(0, Math.max(0, MAX_STREAM_BYTES - (stderrBytes - chunk.length))).toString('utf8')
          stderr += `\n... [truncated: stderr exceeded ${MAX_STREAM_BYTES} bytes]`
          truncated = true
        }
        return
      }
      stderr += chunk.toString('utf8')
    })

    if (opts.stdin && child.stdin) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    } else if (child.stdin) {
      child.stdin.end()
    }

    // Timeout → SIGTERM the whole process group, then SIGKILL after a grace.
    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return
      try {
        if (process.platform !== 'win32') {
          // Negative PID → send to entire process group (tree-kill).
          process.kill(-child.pid, signal)
        } else {
          child.kill(signal)
        }
      } catch {
        // process may already be gone; fall back to direct kill
        try { child.kill(signal) } catch { /* ignore */ }
      }
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      killTree('SIGTERM')
      // Grace period, then SIGKILL.
      setTimeout(() => killTree('SIGKILL'), 2_000).unref()
    }, opts.timeoutMs)
    timeoutHandle.unref?.()

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      finish({
        exitCode: code ?? (timedOut ? 124 : -1),
        stdout,
        stderr,
        signal: signal ?? null,
        timedOut,
        truncated,
      })
    })
  })
}
