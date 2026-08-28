// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import { createDiskSpaceGuard, type DiskSpaceStatus } from './disk-space-guard.js'
import { createChannelWatchdog } from './channel-watchdog.js'
import { createStuckGuard } from './stuck-guard.js'

export interface HostGuards {
  disk: ReturnType<typeof createDiskSpaceGuard>
  channels: ReturnType<typeof createChannelWatchdog>
  stuck: ReturnType<typeof createStuckGuard>
  tick(): {
    disk: DiskSpaceStatus[]
    staleChannels: ReturnType<ReturnType<typeof createChannelWatchdog>['list']>
    stuckRuns: ReturnType<ReturnType<typeof createStuckGuard>['listStuck']>
  }
}

export function createHostGuards(opts: {
  logger: Logger
  diskPaths?: string[]
  onDiskAlert?: (s: DiskSpaceStatus) => void
  onChannelStale?: (ch: { channelId: string }) => void
}): HostGuards {
  const disk = createDiskSpaceGuard({
    paths: opts.diskPaths ?? [process.cwd(), '/tmp'],
    logger: opts.logger,
    onAlert: opts.onDiskAlert,
  })
  const channels = createChannelWatchdog({
    logger: opts.logger,
    onStale: (ch) => opts.onChannelStale?.(ch),
  })
  const stuck = createStuckGuard()

  return {
    disk,
    channels,
    stuck,
    tick() {
      const diskStatus = disk.tick()
      const staleChannels = channels.tick()
      const stuckRuns = stuck.listStuck()
      if (stuckRuns.length) {
        opts.logger.warn({ count: stuckRuns.length, stuckRuns }, 'host-guard: stuck runs')
      }
      return { disk: diskStatus, staleChannels, stuckRuns }
    },
  }
}

export { checkDiskSpace } from './disk-space-guard.js'
export { createChannelWatchdog } from './channel-watchdog.js'
export { createStuckGuard } from './stuck-guard.js'
