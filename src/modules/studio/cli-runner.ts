// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CliRunResult {
  code: number
  stdout: string
  stderr: string
}

export interface CliRunOptions {
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string | undefined>
  input?: string
}

export interface CliRunner {
  which(bin: string): Promise<string | null>
  run(command: string, args: string[], opts?: CliRunOptions): Promise<CliRunResult>
}

function stripForbiddenSandboxArgs(args: string[]): string[] {
  return args.filter((a) => a !== '--no-sandbox' && a !== '--disable-setuid-sandbox')
}

function runWithStdin(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; env: NodeJS.ProcessEnv; input: string },
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number, extra?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr: extra ? `${stderr}${extra}` : stderr })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(124, `Timed out after ${opts.timeoutMs}ms`)
    }, opts.timeoutMs)
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => finish(1, err.message))
    child.on('close', (code) => finish(code ?? 1))
    child.stdin.write(opts.input)
    child.stdin.end()
  })
}

export function createProcessRunner(): CliRunner {
  return {
    async which(bin: string): Promise<string | null> {
      try {
        const { stdout } = await execFileAsync('which', [bin], { timeout: 5_000 })
        const p = stdout.trim()
        return p || null
      } catch {
        return null
      }
    },

    async run(command, args, opts = {}): Promise<CliRunResult> {
      const safeArgs = stripForbiddenSandboxArgs(args)
      const timeoutMs = opts.timeoutMs ?? 30_000
      const env = { ...process.env, ...opts.env }
      if (opts.input != null) {
        return runWithStdin(command, safeArgs, { cwd: opts.cwd, timeoutMs, env, input: opts.input })
      }
      try {
        const { stdout, stderr } = await execFileAsync(command, safeArgs, {
          cwd: opts.cwd,
          timeout: timeoutMs,
          env,
          maxBuffer: 8 * 1024 * 1024,
        })
        return { code: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
      } catch (err: any) {
        if (err?.killed) {
          return { code: 124, stdout: err.stdout ?? '', stderr: err.stderr ?? `Timed out after ${timeoutMs}ms` }
        }
        return {
          code: typeof err?.code === 'number' ? err.code : 1,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? (err instanceof Error ? err.message : String(err)),
        }
      }
    },
  }
}
