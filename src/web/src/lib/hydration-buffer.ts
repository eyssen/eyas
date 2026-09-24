// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface HydrationBuffer<T> {
  /** Start buffering — call right before the replay fetch goes out. */
  begin(): void
  /** Queue the item while hydration is pending; returns false when it should be applied directly. */
  push(item: T): boolean
  /** Stop buffering and hand back what arrived meanwhile, in arrival order. */
  flush(): T[]
  /** Drop the queue and resume pass-through (e.g. the user switched context). */
  clear(): void
}

/**
 * Holds live events that arrive while a replay fetch is still in flight, so the
 * reset performed by the replay cannot wipe them. Events queued during
 * hydration are handed back once for replay in arrival order.
 */
export function createHydrationBuffer<T>(): HydrationBuffer<T> {
  let buffering = false
  let queue: T[] = []

  return {
    begin() {
      buffering = true
      queue = []
    },
    push(item) {
      if (!buffering) return false
      queue.push(item)
      return true
    },
    flush() {
      buffering = false
      const queued = queue
      queue = []
      return queued
    },
    clear() {
      buffering = false
      queue = []
    },
  }
}
