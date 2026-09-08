// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn } from 'node:child_process'

export interface ImageManagerDeps {
  /**
   * Injectable spawn function — lets tests substitute a mock. Signature
   * mirrors `node:child_process.spawn` closely enough for our narrow usage.
   */
  spawnFn?: typeof spawn
  logger?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    debug: (obj: unknown, msg?: string) => void
  }
}

export interface ImageManager {
  /** Resolve true if `docker image inspect <image>` exits 0. */
  imageExists(image: string): Promise<boolean>
  /** Pull `image`. Resolves with exit code (0 on success). */
  pullImage(image: string): Promise<number>
  /**
   * Ensure an image is locally cached. If missing, pulls it. Returns true
   * if the image is ready to use, false otherwise.
   */
  ensureImage(image: string, opts?: { autoPull?: boolean }): Promise<boolean>
}

export function createImageManager(deps: ImageManagerDeps = {}): ImageManager {
  const spawnFn = deps.spawnFn ?? spawn
  const log = deps.logger

  function runDocker(args: string[]): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
      let stderr = ''
      const child = spawnFn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8') })
      child.on('error', () => resolve({ code: -1, stderr: 'docker binary not found' }))
      child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
    })
  }

  return {
    async imageExists(image: string): Promise<boolean> {
      const { code } = await runDocker(['image', 'inspect', image])
      return code === 0
    },

    async pullImage(image: string): Promise<number> {
      log?.info({ image }, 'docker pull starting')
      const { code, stderr } = await runDocker(['pull', image])
      if (code !== 0) {
        log?.warn({ image, stderr }, 'docker pull failed')
      }
      return code
    },

    async ensureImage(image: string, opts: { autoPull?: boolean } = {}): Promise<boolean> {
      if (await this.imageExists(image)) return true
      if (opts.autoPull === false) {
        log?.warn({ image }, 'image missing and autoPull=false')
        return false
      }
      const code = await this.pullImage(image)
      return code === 0
    },
  }
}
