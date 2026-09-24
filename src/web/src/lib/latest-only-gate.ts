// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface LatestOnlyGate {
  /** Take a ticket for a request that is about to go out. */
  issue(): number
  /**
   * True only if this ticket is newer than every response already applied.
   * Accepting also marks it applied, so a later-arriving OLDER response is
   * rejected and the same ticket can never be applied twice.
   */
  accept(ticket: number): boolean
}

/**
 * Last-request-wins ordering for overlapping fetches of the same resource.
 *
 * Several triggers can have a fetch in flight at once (initial load, socket
 * reconnect, a live refetch ping), and they resolve in whatever order the
 * network decides. Without this, a slow OLDER response lands after a fast
 * newer one and the UI silently rolls back to stale data — a per-effect
 * `cancelled` flag can't help, since none of those requests was cancelled.
 */
export function createLatestOnlyGate(): LatestOnlyGate {
  let issued = 0
  let applied = 0
  return {
    issue: () => ++issued,
    accept(ticket: number): boolean {
      if (ticket <= applied) return false
      applied = ticket
      return true
    },
  }
}
