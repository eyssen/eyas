// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'

export interface ChannelLiveness {
  channelId: string
  lastOkAt: number | null
  lastErrorAt: number | null
  lastError?: string
  fatal: boolean
}

export function createChannelWatchdog(opts: {
  logger: Logger
  /** Channels quiet longer than this are considered stale. */
  staleMs?: number
  onStale?: (ch: ChannelLiveness) => void
  onFatal?: (ch: ChannelLiveness) => void
}) {
  const staleMs = opts.staleMs ?? 15 * 60_000
  const state = new Map<string, ChannelLiveness>()

  return {
    recordOk(channelId: string) {
      const cur = state.get(channelId) ?? { channelId, lastOkAt: null, lastErrorAt: null, fatal: false }
      cur.lastOkAt = Date.now()
      cur.fatal = false
      state.set(channelId, cur)
    },

    recordError(channelId: string, err: unknown, fatal = false) {
      const cur = state.get(channelId) ?? { channelId, lastOkAt: null, lastErrorAt: null, fatal: false }
      cur.lastErrorAt = Date.now()
      cur.lastError = err instanceof Error ? err.message : String(err)
      cur.fatal = fatal || cur.fatal
      state.set(channelId, cur)
      if (cur.fatal) opts.onFatal?.(cur)
    },

    tick(now = Date.now()): ChannelLiveness[] {
      const stale: ChannelLiveness[] = []
      for (const ch of state.values()) {
        if (ch.fatal) {
          opts.onFatal?.(ch)
          continue
        }
        if (ch.lastOkAt != null && now - ch.lastOkAt > staleMs) {
          stale.push(ch)
          opts.onStale?.(ch)
          opts.logger.warn({ channelId: ch.channelId, ageMs: now - ch.lastOkAt }, 'host-guard: channel stale')
        }
      }
      return stale
    },

    list(): ChannelLiveness[] {
      return Array.from(state.values())
    },
  }
}
