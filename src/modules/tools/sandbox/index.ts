// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn } from 'node:child_process'
import { runInContainer, type DockerRunnerDeps } from './docker-runner.js'
import { createImageManager } from './image-manager.js'
import type { DockerRunResult, DockerSandbox, DockerSandboxConfig } from './types.js'

export * from './types.js'
export { buildDockerArgs, filterEnv, runInContainer } from './docker-runner.js'
export { createImageManager } from './image-manager.js'

export interface CreateDockerSandboxDeps extends DockerRunnerDeps {
  /**
   * If true, `isAvailable()` also runs `docker info` (slower, but confirms
   * the daemon is reachable, not just the CLI binary). Default false.
   */
  probeDaemon?: boolean
}

/**
 * Factory for the docker sandbox runner.
 *
 * The `tool-executor` will call `sandbox.isAvailable()` once at module init.
 * If it returns false, the caller should fall back to `'process'` mode and
 * emit a WARN log — the contract is that a missing docker binary MUST NOT
 * crash the process, just downgrade isolation.
 */
export function createDockerSandbox(deps: CreateDockerSandboxDeps = {}): DockerSandbox {
  const spawnFn = deps.spawnFn ?? spawn
  const log = deps.logger

  return {
    async isAvailable(): Promise<boolean> {
      // Fast path: `docker --version` returns 0 if the CLI is installed.
      const cliOk = await new Promise<boolean>((resolve) => {
        try {
          const child = spawnFn('docker', ['--version'], { stdio: 'ignore' })
          child.on('error', () => resolve(false))
          child.on('close', (code) => resolve(code === 0))
        } catch {
          resolve(false)
        }
      })
      if (!cliOk) {
        log?.warn({}, 'docker CLI not available — sandbox will fall back to process mode')
        return false
      }
      if (!deps.probeDaemon) return true

      // Deep check: `docker info` confirms the daemon is reachable.
      return await new Promise<boolean>((resolve) => {
        try {
          const child = spawnFn('docker', ['info'], { stdio: 'ignore' })
          child.on('error', () => resolve(false))
          child.on('close', (code) => resolve(code === 0))
        } catch {
          resolve(false)
        }
      })
    },

    async run(command: string, args: string[], config: DockerSandboxConfig): Promise<DockerRunResult> {
      return await runInContainer(command, args, config, deps)
    },
  }
}
