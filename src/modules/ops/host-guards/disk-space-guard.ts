// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { statfsSync } from 'node:fs'
import type { Logger } from 'pino'

export interface DiskSpaceStatus {
  path: string
  freeBytes: number
  totalBytes: number
  freeRatio: number
  level: 'ok' | 'warn' | 'critical'
}

export function checkDiskSpace(path: string, opts?: {
  warnRatio?: number
  criticalRatio?: number
}): DiskSpaceStatus {
  const warnRatio = opts?.warnRatio ?? 0.15
  const criticalRatio = opts?.criticalRatio ?? 0.05
  const st = statfsSync(path)
  // Node 18.15+ statfs: bsize * bavail / blocks
  const bsize = Number((st as any).bsize ?? (st as any).frsize ?? 4096)
  const freeBytes = bsize * Number((st as any).bavail ?? 0)
  const totalBytes = bsize * Number((st as any).blocks ?? 0)
  const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1
  let level: DiskSpaceStatus['level'] = 'ok'
  if (freeRatio <= criticalRatio) level = 'critical'
  else if (freeRatio <= warnRatio) level = 'warn'
  return { path, freeBytes, totalBytes, freeRatio, level }
}

export function createDiskSpaceGuard(opts: {
  paths: string[]
  logger: Logger
  warnRatio?: number
  criticalRatio?: number
  onAlert?: (status: DiskSpaceStatus) => void
}) {
  return {
    tick(): DiskSpaceStatus[] {
      const results: DiskSpaceStatus[] = []
      for (const p of opts.paths) {
        try {
          const status = checkDiskSpace(p, {
            warnRatio: opts.warnRatio,
            criticalRatio: opts.criticalRatio,
          })
          results.push(status)
          if (status.level !== 'ok') {
            opts.logger.warn({ status }, 'host-guard: disk space low')
            opts.onAlert?.(status)
          }
        } catch (err) {
          opts.logger.debug({ err, path: p }, 'host-guard: disk check failed')
        }
      }
      return results
    },
  }
}
