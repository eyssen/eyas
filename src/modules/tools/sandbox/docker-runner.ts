// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DEFAULT_IMAGE, MAX_STREAM_BYTES, type DockerRunResult, type DockerSandboxConfig } from './types.js'

export interface DockerRunnerDeps {
  /**
   * Injectable spawn function — lets tests swap in a mock. Must behave like
   * `node:child_process.spawn` for our narrow usage (pipe stdio, close event).
   */
  spawnFn?: typeof spawn
  /** Host process.env override; test seam. */
  hostEnv?: NodeJS.ProcessEnv
  logger?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    debug: (obj: unknown, msg?: string) => void
  }
}

/**
 * Filter the host environment down to the configured allowlist. Keys not in
 * the allowlist are dropped. Undefined values are dropped.
 *
 * Exposed for testing — this is the single source of truth for env leakage
 * prevention.
 */
export function filterEnv(
  hostEnv: NodeJS.ProcessEnv,
  allowlist: string[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!allowlist || allowlist.length === 0) return out
  for (const key of allowlist) {
    const value = hostEnv[key]
    if (typeof value === 'string' && value.length > 0) out[key] = value
  }
  return out
}

/**
 * Build the full argument vector passed to `docker`. Separated from spawn
 * so we can exhaustively unit-test argument construction without requiring
 * a docker binary on the test host.
 */
export function buildDockerArgs(
  containerName: string,
  command: string,
  cmdArgs: string[],
  config: DockerSandboxConfig,
  env: Record<string, string>,
): string[] {
  const image = config.image ?? DEFAULT_IMAGE
  const network = config.network ?? 'none'
  const memoryMb = config.memoryLimitMb ?? 512
  const cpus = config.cpuLimit ?? 1.0
  const pidsLimit = config.pidsLimit ?? 256
  const tmpfsSizeMb = config.tmpfsSizeMb ?? 64
  const mountMode = config.mountMode ?? 'ro'
  const user = config.user // may be undefined → docker default (or runner-level fill)

  const args: string[] = ['run', '--rm']
  args.push('--name', containerName)
  args.push('--network', network)
  args.push('--memory', `${memoryMb}m`)
  args.push('--memory-swap', `${memoryMb}m`) // block swap expansion
  args.push('--cpus', String(cpus))
  args.push('--pids-limit', String(pidsLimit))
  args.push('--read-only')
  args.push('--cap-drop', 'ALL')
  args.push('--security-opt', 'no-new-privileges')
  // Writable scratch: tmpfs at /tmp — noexec for defense-in-depth.
  args.push('--tmpfs', `/tmp:rw,noexec,nosuid,size=${tmpfsSizeMb}m`)

  if (user) args.push('-u', user)

  // Env vars (already filtered via allowlist by caller).
  for (const [k, v] of Object.entries(env)) {
    args.push('-e', `${k}=${v}`)
  }

  // Working directory bind mount.
  args.push('-v', `${config.workingDirectory}:/work:${mountMode}`)
  args.push('-w', '/work')

  // Image + command + args (all positional).
  args.push(image)
  args.push(command)
  for (const a of cmdArgs) args.push(a)

  return args
}

/**
 * Run `command` inside an ephemeral docker container with the given config.
 * This is the low-level entry point used by the sandbox factory.
 */
export async function runInContainer(
  command: string,
  cmdArgs: string[],
  config: DockerSandboxConfig,
  deps: DockerRunnerDeps = {},
): Promise<DockerRunResult> {
  const spawnFn = deps.spawnFn ?? spawn
  const hostEnv = deps.hostEnv ?? process.env
  const log = deps.logger

  if (!config.workingDirectory || typeof config.workingDirectory !== 'string') {
    throw new Error('DockerSandboxConfig.workingDirectory is required')
  }

  const containerName = `eyas-sbx-${randomUUID().slice(0, 8)}`
  const timeoutMs = config.timeoutMs ?? 60_000
  const env = filterEnv(hostEnv, config.envAllowlist)
  const args = buildDockerArgs(containerName, command, cmdArgs, config, env)

  log?.debug({ containerName, image: config.image, network: config.network }, 'docker sandbox starting')

  return await new Promise<DockerRunResult>((resolve) => {
    const start = Date.now()
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false

    // Route via `as unknown` because stdio: ['ignore', 'pipe', 'pipe'] yields
    // ChildProcessByStdio<null, Readable, Readable>, which TS refuses to widen
    // to ChildProcessWithoutNullStreams directly. The runtime shape is
    // compatible — stdin is null but stdout/stderr are the expected Readables.
    const child: ChildProcessWithoutNullStreams = spawnFn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as unknown as ChildProcessWithoutNullStreams

    const finish = (r: DockerRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      resolve(r)
    }

    child.on('error', (err) => {
      finish({
        exitCode: -1,
        stdout,
        stderr: stderr + (stderr ? '\n' : '') + `spawn error: ${err.message}`,
        truncated,
        durationMs: Date.now() - start,
        timedOut,
      })
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STREAM_BYTES) {
        if (!truncated) {
          const remaining = Math.max(0, MAX_STREAM_BYTES - (stdoutBytes - chunk.length))
          stdout += chunk.slice(0, remaining).toString('utf8')
          stdout += `\n... [truncated: stdout exceeded ${MAX_STREAM_BYTES} bytes]`
          truncated = true
        }
        return
      }
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STREAM_BYTES) {
        if (!truncated) {
          const remaining = Math.max(0, MAX_STREAM_BYTES - (stderrBytes - chunk.length))
          stderr += chunk.slice(0, remaining).toString('utf8')
          stderr += `\n... [truncated: stderr exceeded ${MAX_STREAM_BYTES} bytes]`
          truncated = true
        }
        return
      }
      stderr += chunk.toString('utf8')
    })

    // Timeout → `docker kill` the named container. We do NOT rely on
    // killing the local `docker run` process, since that leaves the
    // container running; `docker kill` forwards SIGKILL to the PID-1
    // inside the container and the `--rm` flag reaps it.
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      log?.warn({ containerName, timeoutMs }, 'docker sandbox timeout — killing container')
      try {
        const killer = spawnFn('docker', ['kill', containerName], { stdio: 'ignore' })
        killer.on('error', () => { /* ignore */ })
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    timeoutHandle.unref?.()

    child.on('close', (code) => {
      finish({
        exitCode: code ?? (timedOut ? 124 : -1),
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - start,
        timedOut,
      })
    })
  })
}
