// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Configuration for a single Docker sandbox invocation.
 *
 * All limits are enforced by Docker at container-creation time; if the host
 * kernel does not support a particular cgroup feature (memory, pids, cpus)
 * the `docker run` call will fail loudly rather than silently degrade.
 */
export interface DockerSandboxConfig {
  /** Container image reference. Default: `ghcr.io/eyssen/eyas-sandbox:latest`. */
  image?: string
  /** Network mode. Default `'none'` for strict isolation. */
  network?: 'none' | 'bridge' | 'host'
  /** RAM cap in MiB. Default 512. */
  memoryLimitMb?: number
  /** CPU cap (whole or fractional CPUs). Default 1.0. */
  cpuLimit?: number
  /**
   * Environment variables to forward from host into the container.
   * Only keys present in this list are propagated — everything else is
   * stripped. Default: empty (no env leakage).
   */
  envAllowlist?: string[]
  /** Host path to mount into the container at `/work`. Required. */
  workingDirectory: string
  /** Mount mode for the working directory. Default `'ro'`. */
  mountMode?: 'ro' | 'rw'
  /** Hard timeout in milliseconds. Default 60_000. */
  timeoutMs?: number
  /** Process IDs cap inside the container. Default 256. */
  pidsLimit?: number
  /**
   * Optional UID:GID string (e.g. `"1000:1000"`). When omitted, defaults to
   * the current host user so written files end up with sensible ownership
   * even if `mountMode === 'rw'`.
   */
  user?: string
  /** Size of tmpfs mounted at `/tmp` for scratch writes, in MiB. Default 64. */
  tmpfsSizeMb?: number
}

export interface DockerRunResult {
  exitCode: number
  stdout: string
  stderr: string
  /** True when either stream was truncated at the per-stream byte cap. */
  truncated: boolean
  durationMs: number
  /** True when the container was killed because `timeoutMs` elapsed. */
  timedOut: boolean
}

export interface DockerSandbox {
  /** Returns true if the `docker` binary is available and responsive. */
  isAvailable(): Promise<boolean>
  /** Run `command` with `args` inside an ephemeral container. */
  run(command: string, args: string[], config: DockerSandboxConfig): Promise<DockerRunResult>
}

/** Per-stream byte cap for stdout/stderr. Mirrors tool-executor (1 MiB). */
export const MAX_STREAM_BYTES = 1024 * 1024

/** Default container image. Can be overridden at call site or via config. */
export const DEFAULT_IMAGE = 'ghcr.io/eyssen/eyas-sandbox:latest'
