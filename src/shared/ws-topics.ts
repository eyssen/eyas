// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Single source of truth for WebSocket topic names, shared by backend
 * broadcast sites (import '@shared/ws-topics.js') and frontend subscriptions
 * (import '@/lib/ws-topics' — a thin re-export; the web '@shared' alias
 * points at src/modules and must NOT be used).
 * RULE: WS frames stay THIN (ids + refetch pings); data crosses CASL-guarded
 * REST. Topic subscription is authenticated but not permission-scoped.
 * Contract: tests/contracts/ws-topics.contract.test.ts — it bans inline topic
 * literals at every subscribe/broadcast call site and fails on any key that is
 * wired on only one side.
 */
export const WS_TOPICS = {
  /** Module/budget/communication status — broad "something changed" pings. */
  system: 'system',
  /** Agent run lifecycle (started/progress/completed/failed/stuck/cancelled) — list-level. */
  agentRuns: 'agent-runs',
  /** Autonomy ladder + approval queue changes (thin: ids only, refetch via REST). */
  autonomy: 'autonomy',
  /** Mission Control aggregator ping (thin: refetch /mission-control/snapshot). */
  missionControl: 'mission-control',
  board: (projectId: string) => `board:${projectId}`,
  notifications: (userId: string) => `notifications:${userId}`,
  /** Per-agent-definition execution events (agent detail page). */
  agent: (agentId: string) => `agent:${agentId}`,
  chat: (conversationId: string) => `chat:${conversationId}`,
  orchestration: (runId: string) => `orchestration:${runId}`,
  teamEvent: (teamSessionId: string) => `team:${teamSessionId}:event`,
  teamProposed: (conversationId: string) => `team:proposed:${conversationId}`,
  /** Media job lifecycle ping (thin: refetch /media/jobs + /media/providers). */
  media: 'media',
  /** Studio job lifecycle ping (thin: refetch /studio/jobs + /studio/status). */
  studio: 'studio',
} as const

export type WsTopicKey = keyof typeof WS_TOPICS
export const WS_TOPIC_KEYS = Object.keys(WS_TOPICS) as WsTopicKey[]

/**
 * D14 — `event` value of the NACK frame the registry sends back (instead of
 * registering the subscription) when the topic ACL denies a subscribe. Not a
 * subscribable topic itself — a frame on the connection, not a pub/sub
 * channel — so it deliberately lives OUTSIDE the WS_TOPICS catalogue above;
 * it's co-located here purely so the backend (registry) and frontend (WS
 * hook) import the same literal instead of each hand-typing 'subscribe_denied'.
 */
export const WS_SUBSCRIBE_DENIED_EVENT = 'subscribe_denied'
