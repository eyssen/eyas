/**
 * WebSocket connection registry with topic-based pub/sub.
 *
 * Uses Map<userId, Set<ws>> for connections and
 * Map<ws, Set<topic>> for per-connection subscriptions.
 */

import { WS_SUBSCRIBE_DENIED_EVENT } from '@shared/ws-topics.js'

export interface WSConnection {
  send(data: string): void
  readyState: number
  /** Real sockets (Bun's ServerWebSocket) have this; test doubles may omit it. */
  close?(): void
}

export interface WSMessage {
  event: string
  data: unknown
}

/**
 * D14 — per-subscribe ownership check. Injected as a plain object so this
 * core module never imports anything module-specific: the actual ownership
 * logic (conversation/team-session parent-chain walks, role lookups) lives
 * behind `src/core/http/ws-acl.ts`'s `createTopicAcl()`, which modules wire
 * resolvers into via ctx.
 */
export interface WSTopicAcl {
  canSubscribe(userId: string, topic: string): boolean
}

export interface WSConnectionRegistry {
  add(userId: string, ws: WSConnection): void
  remove(userId: string, ws: WSConnection): void
  getConnections(userId: string): WSConnection[]
  subscribe(userId: string, ws: WSConnection, topic: string): void
  unsubscribe(userId: string, ws: WSConnection, topic: string): void
  broadcast(topic: string, message: WSMessage): void
  broadcastToUser(userId: string, message: WSMessage): void
  /** D14 — when set, subscribe() consults it and NACKs a denied topic instead of registering it. */
  setTopicAcl(acl: WSTopicAcl): void
  /** Closes every live socket for a user (logout / suspend / archive) — best-effort. */
  closeUser(userId: string): void
}

const WS_OPEN = 1

export function createWSConnectionRegistry(): WSConnectionRegistry {
  const connections = new Map<string, Set<WSConnection>>()
  const subscriptions = new Map<WSConnection, Set<string>>()
  let topicAcl: WSTopicAcl | null = null

  function isOpen(ws: WSConnection): boolean {
    return ws.readyState === WS_OPEN
  }

  return {
    add(userId, ws) {
      if (!connections.has(userId)) {
        connections.set(userId, new Set())
      }
      connections.get(userId)!.add(ws)
      subscriptions.set(ws, new Set())
    },

    remove(userId, ws) {
      connections.get(userId)?.delete(ws)
      if (connections.get(userId)?.size === 0) {
        connections.delete(userId)
      }
      subscriptions.delete(ws)
    },

    getConnections(userId) {
      const set = connections.get(userId)
      return set ? [...set] : []
    },

    setTopicAcl(acl) {
      topicAcl = acl
    },

    subscribe(userId, ws, topic) {
      // No ACL wired (e.g. a bare registry in a unit test) — behave exactly
      // as before T11: unrestricted subscribe.
      if (topicAcl && !topicAcl.canSubscribe(userId, topic)) {
        if (isOpen(ws)) {
          ws.send(JSON.stringify({ event: WS_SUBSCRIBE_DENIED_EVENT, data: { topic } }))
        }
        return
      }
      subscriptions.get(ws)?.add(topic)
    },

    unsubscribe(_userId, ws, topic) {
      subscriptions.get(ws)?.delete(topic)
    },

    broadcast(topic, message) {
      // Include the topic so clients can dispatch to the matching handlers
      // only, instead of fanning every frame out to every subscriber.
      const payload = JSON.stringify({ ...message, topic })
      for (const [ws, topics] of subscriptions) {
        if (topics.has(topic) && isOpen(ws)) {
          ws.send(payload)
        }
      }
    },

    broadcastToUser(userId, message) {
      const set = connections.get(userId)
      if (!set) return
      const payload = JSON.stringify(message)
      for (const ws of set) {
        if (isOpen(ws)) {
          ws.send(payload)
        }
      }
    },

    closeUser(userId) {
      const set = connections.get(userId)
      if (!set) return
      for (const ws of [...set]) {
        try { ws.close?.() } catch { /* best-effort */ }
      }
    },
  }
}
