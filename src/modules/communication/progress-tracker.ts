// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Channel progress placeholders: "working…" message that is either replaced by
// the real reply or rewritten into an explicit failure by a watchdog.

export interface ProgressEntry {
  channelType: string
  channelId: string
  /** Provider message id of the placeholder. */
  placeholderMessageId: string
  /** Inbound event / message id that triggered the work. */
  inboundMessageId: string
  createdAt: number
  /** Optional agent/session key for wedged detection. */
  runKey?: string
}

export interface ProgressTracker {
  track(entry: ProgressEntry): void
  /** Pop and return the placeholder for this inbound (if any). */
  take(channelType: string, channelId: string, inboundMessageId?: string): ProgressEntry | null
  /** Entries older than maxAgeMs (or with missing run when checkRun says gone). */
  listOrphans(opts: {
    maxAgeMs: number
    now?: number
    isRunAlive?: (runKey: string) => boolean
  }): ProgressEntry[]
  clear(channelType: string, channelId: string): void
}

function keyOf(channelType: string, channelId: string, inboundMessageId?: string): string {
  return `${channelType}:${channelId}:${inboundMessageId ?? '*'}`
}

export function createProgressTracker(): ProgressTracker {
  const map = new Map<string, ProgressEntry>()

  return {
    track(entry) {
      map.set(keyOf(entry.channelType, entry.channelId, entry.inboundMessageId), entry)
      // Also keep a channel-level pointer for take-without-id.
      map.set(keyOf(entry.channelType, entry.channelId), entry)
    },

    take(channelType, channelId, inboundMessageId) {
      const k = keyOf(channelType, channelId, inboundMessageId)
      const entry = map.get(k) ?? (inboundMessageId ? map.get(keyOf(channelType, channelId)) : undefined)
      if (!entry) return null
      map.delete(keyOf(entry.channelType, entry.channelId, entry.inboundMessageId))
      map.delete(keyOf(entry.channelType, entry.channelId))
      return entry
    },

    listOrphans({ maxAgeMs, now = Date.now(), isRunAlive }) {
      const seen = new Set<string>()
      const out: ProgressEntry[] = []
      for (const entry of map.values()) {
        const id = `${entry.channelType}:${entry.channelId}:${entry.inboundMessageId}`
        if (seen.has(id)) continue
        seen.add(id)
        const aged = now - entry.createdAt >= maxAgeMs
        const deadRun = entry.runKey && isRunAlive ? !isRunAlive(entry.runKey) : false
        if (aged || deadRun) out.push(entry)
      }
      return out
    },

    clear(channelType, channelId) {
      for (const [k, v] of map) {
        if (v.channelType === channelType && v.channelId === channelId) map.delete(k)
      }
    },
  }
}
