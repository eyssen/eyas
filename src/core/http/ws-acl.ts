// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * D14 — the topic ACL consulted by WSConnectionRegistry.subscribe(). Parses
 * every shape in the WS_TOPICS catalogue and decides who may subscribe:
 *
 *  - globals + `agent:<id>` + `board:<id>` — any authenticated (active,
 *    non-deny-lookup) user. Board membership scoping is deferred.
 *  - `notifications:<userId>` — only that user (or an elevated role).
 *  - per-id CONTENT topics (`chat:<id>`, `team:<id>:event`,
 *    `team:proposed:<id>`, `orchestration:<id>`) — delegated to a resolver
 *    registered by the module that owns the resource. No resolver, a
 *    resolver that throws, or an id it can't resolve all deny (fail-closed):
 *    the whole point is that a leaked/guessed id must never work.
 *  - anything else that looks per-id (contains ':') but isn't one of the
 *    above shapes — deny (a topic the ACL doesn't recognize is NOT a safe
 *    default-allow).
 *
 * Role is looked up FRESH per subscribe (not cached) via an injected
 * `getUserRole` — closes the stale-role gap a cached/JWT-carried role would
 * have across a live socket. A missing/suspended user (lookup returns
 * undefined) denies EVERYTHING, including the globals.
 *
 * Deliberately module-free: resolvers and the role lookup are injected by
 * the modules that own the underlying data (agent, conversations, auth) via
 * ctx, the same lazy pattern as ctx.wsRegistry — see websocket.ts's
 * WSTopicAcl for the consumer side.
 */

import { WS_TOPICS } from '@shared/ws-topics.js'
import type { WSTopicAcl } from './websocket.js'

/** Per-id content topics whose ownership is resolved by an injected resolver. */
export type OwnershipPrefix = 'chat' | 'teamEvent' | 'teamProposed' | 'orchestration'

export interface TopicAcl extends WSTopicAcl {
  /** Registers (or replaces) the ownership resolver for one per-id topic shape. */
  registerResolver(prefix: OwnershipPrefix, resolver: (userId: string, id: string) => boolean): void
  /** Fresh-per-subscribe role lookup. Returns undefined for a missing/suspended user. */
  setRoleLookup(lookup: (userId: string) => string | undefined): void
}

type ParsedTopic =
  | { kind: 'global' }
  | { kind: 'agent'; id: string }
  | { kind: 'board'; id: string }
  | { kind: 'notifications'; id: string }
  | { kind: OwnershipPrefix; id: string }
  | { kind: 'unknown' }

const GLOBAL_TOPICS = new Set<string>([
  WS_TOPICS.system,
  WS_TOPICS.agentRuns,
  WS_TOPICS.autonomy,
  WS_TOPICS.missionControl,
  WS_TOPICS.media,
  WS_TOPICS.studio,
])

const ELEVATED_ROLES = new Set(['owner', 'admin'])

/**
 * Order matters: `team:proposed:<id>` is checked BEFORE the generic
 * `team:<id>:event` pattern — both share the `team:` prefix, so a naive
 * single split conflates them (e.g. a convId that itself contains ':event'
 * would otherwise get parsed as a teamEvent with the wrong id).
 */
function parseTopic(topic: string): ParsedTopic {
  if (GLOBAL_TOPICS.has(topic)) return { kind: 'global' }

  const proposed = topic.match(/^team:proposed:(.+)$/)
  if (proposed) return { kind: 'teamProposed', id: proposed[1] }

  const teamEvent = topic.match(/^team:(.+):event$/)
  if (teamEvent) return { kind: 'teamEvent', id: teamEvent[1] }

  const chat = topic.match(/^chat:(.+)$/)
  if (chat) return { kind: 'chat', id: chat[1] }

  const orchestration = topic.match(/^orchestration:(.+)$/)
  if (orchestration) return { kind: 'orchestration', id: orchestration[1] }

  const notifications = topic.match(/^notifications:(.+)$/)
  if (notifications) return { kind: 'notifications', id: notifications[1] }

  const agent = topic.match(/^agent:(.+)$/)
  if (agent) return { kind: 'agent', id: agent[1] }

  const board = topic.match(/^board:(.+)$/)
  if (board) return { kind: 'board', id: board[1] }

  return { kind: 'unknown' }
}

export function createTopicAcl(): TopicAcl {
  const resolvers = new Map<OwnershipPrefix, (userId: string, id: string) => boolean>()
  let roleLookup: ((userId: string) => string | undefined) | null = null

  return {
    registerResolver(prefix, resolver) {
      resolvers.set(prefix, resolver)
    },

    setRoleLookup(lookup) {
      roleLookup = lookup
    },

    canSubscribe(userId, topic) {
      const role = roleLookup?.(userId)
      if (!role) return false // missing/suspended user, or lookup not wired yet — fail closed
      if (ELEVATED_ROLES.has(role)) return true

      const parsed = parseTopic(topic)
      switch (parsed.kind) {
        case 'global':
        case 'agent':
        case 'board':
          return true
        case 'notifications':
          return parsed.id === userId
        case 'chat':
        case 'teamEvent':
        case 'teamProposed':
        case 'orchestration': {
          const resolver = resolvers.get(parsed.kind)
          if (!resolver) return false
          try {
            return resolver(userId, parsed.id)
          } catch {
            return false
          }
        }
        case 'unknown':
        default:
          return false
      }
    },
  }
}
