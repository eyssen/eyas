// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Bus events the auth module emits.

/**
 * A user's role or status was changed, or the user was archived
 * (PATCH /api/v1/users/:id, DELETE /api/v1/users/:id). A module that holds a
 * long-lived right of the target — the OpenCode terminal socket — asks it
 * again on this instead of waiting for the next connect. Not forwarded to
 * WebSocket clients (ws-bridge.ts); the audit module logs it with `userId`
 * as the actor and `targetId` as the target.
 */
export const USER_ACCESS_CHANGED = 'eyas.auth.user.access_changed'

export interface UserAccessChangedEvent {
  /** Who made the change. */
  userId: string
  /** The user whose role or status changed. */
  targetId: string
  role?: string
  status?: string
}
