// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { EventStore } from '@modules/event-store/event-store'
import type { AgentEvent } from '@modules/event-store/types'
import {
  AgentSessionBusSubjects,
  type AgentRunSnapshot,
  type AgentSessionRegistry,
  type MissionControlSnapshot,
  type MissionControlTotals,
} from './types.js'

/**
 * Minimal shape of a daily-cost repository. Production bindings can
 * provide a real implementation; tests inject a stub.
 */
export interface DailyStatsProvider {
  completedToday(): number
  costTodayUsd(): number
}

export interface AggregatorOptions {
  throttleMs?: number
  now?: () => number
}

export interface Aggregator {
  getSnapshot(): Promise<MissionControlSnapshot>
  subscribe(cb: (snapshot: MissionControlSnapshot) => void): () => void
  /** Stop internal bus subscriptions. */
  dispose(): void
}

const DEFAULT_THROTTLE_MS = 250

/**
 * Build a live snapshot from the session registry + latest event-store
 * entries, and push updates whenever relevant bus events fire.
 *
 * Throttling: at most one delivery per `throttleMs` (default 250ms) per
 * subscriber, using a trailing-edge debounce. Subscribers receive the
 * most recent snapshot, never stale mid-flight data.
 */
export function createAggregator(
  registry: AgentSessionRegistry,
  events: EventStore,
  bus: EyasBus,
  stats: DailyStatsProvider,
  opts: AggregatorOptions = {},
): Aggregator {
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS
  const now = opts.now ?? (() => Date.now())

  type Subscriber = {
    cb: (s: MissionControlSnapshot) => void
    timer: ReturnType<typeof setTimeout> | null
    lastDelivered: number
  }
  const subscribers = new Set<Subscriber>()

  async function buildSnapshot(): Promise<MissionControlSnapshot> {
    const entries = registry.list()
    const agents: AgentRunSnapshot[] = await Promise.all(
      entries.map(async (e) => {
        const latest = await latestEventFor(events, e.sessionId)
        const currentAction = deriveCurrentAction(latest)
        const pendingApprovals = await countPendingApprovals(events, e.sessionId)
        return {
          sessionId: e.sessionId,
          agentId: e.agentId,
          agentName: e.agentName,
          ownerUserId: e.ownerUserId,
          status: e.status,
          startedAt: e.startedAt,
          lastUpdatedAt: latest?.ts ?? e.startedAt,
          currentTurn: e.currentTurn,
          maxTurns: e.maxTurns,
          tokensUsed: e.tokensUsed,
          tokensBudget: e.tokensBudget,
          costUsd: e.costUsd,
          currentAction,
          lastEventType: latest?.type ?? null,
          pendingApprovals,
          team: e.team,
          parentSessionId: e.parentSessionId,
        } satisfies AgentRunSnapshot
      }),
    )

    const totals: MissionControlTotals = {
      running: agents.filter((a) => a.status === 'running').length,
      waiting: agents.filter((a) => a.status === 'waiting_approval').length,
      completedToday: stats.completedToday(),
      costTodayUsd: stats.costTodayUsd(),
    }

    return { timestamp: now(), agents, totals }
  }

  function scheduleBroadcast() {
    for (const sub of subscribers) {
      if (sub.timer) continue
      const sinceLast = now() - sub.lastDelivered
      const delay = sinceLast >= throttleMs ? 0 : throttleMs - sinceLast
      sub.timer = setTimeout(() => {
        sub.timer = null
        sub.lastDelivered = now()
        buildSnapshot()
          .then((snap) => sub.cb(snap))
          .catch(() => {
            /* swallowed — subscriber's job to log */
          })
      }, delay)
    }
  }

  // Bus subscriptions — any of these warrants a re-broadcast. The
  // `agent.session.*` subjects are the module's own vocabulary (consumed by the
  // metrics collector); the run supervisor — the only producer of real run
  // lifecycle events — emits on `eyas.agent.run.*`, so without that wildcard
  // the dashboard would only ever show its initial snapshot.
  const watchedSubjects: string[] = [...Object.values(AgentSessionBusSubjects), 'eyas.agent.run.*']
  const subscriptions = watchedSubjects.map((s) =>
    bus.on(s, async () => {
      scheduleBroadcast()
    }),
  )

  return {
    async getSnapshot() {
      return buildSnapshot()
    },
    subscribe(cb) {
      const sub: Subscriber = { cb, timer: null, lastDelivered: 0 }
      subscribers.add(sub)
      // Deliver an initial snapshot asynchronously so the caller can
      // finish subscribing before the first callback fires.
      buildSnapshot()
        .then((snap) => {
          sub.lastDelivered = now()
          cb(snap)
        })
        .catch(() => {
          /* ignore */
        })
      return () => {
        if (sub.timer) clearTimeout(sub.timer)
        subscribers.delete(sub)
      }
    },
    dispose() {
      for (const s of subscriptions) bus.off(s)
      for (const sub of subscribers) {
        if (sub.timer) clearTimeout(sub.timer)
      }
      subscribers.clear()
    },
  }
}

async function latestEventFor(events: EventStore, sessionId: string): Promise<AgentEvent | null> {
  const last = await events.latestSeq(sessionId)
  if (last < 0) return null
  const arr = await events.queryArray(sessionId, { fromSeq: last, toSeq: last, limit: 1 })
  return arr[0] ?? null
}

function deriveCurrentAction(ev: AgentEvent | null): string | null {
  if (!ev) return null
  switch (ev.type) {
    case 'ToolCall': {
      const name = (ev.payload as any)?.toolName
      return name ? `Executing tool: ${String(name)}` : 'Executing tool'
    }
    case 'ToolResult':
      return 'Tool result received'
    case 'LlmCall': {
      const model = (ev.payload as any)?.model
      return model ? `Calling model: ${String(model)}` : 'Calling model'
    }
    case 'LlmResponse':
      return 'Processing model response'
    case 'StateTransition': {
      const to = (ev.payload as any)?.to
      return to ? `State: ${String(to)}` : 'State change'
    }
    case 'ApprovalRequested':
      return 'Awaiting approval'
    case 'ApprovalGranted':
      return 'Approval granted'
    default:
      return ev.type
  }
}

async function countPendingApprovals(events: EventStore, sessionId: string): Promise<number> {
  const requested = await events.getByTypes(sessionId, ['ApprovalRequested'])
  if (requested.length === 0) return 0
  const granted = await events.getByTypes(sessionId, ['ApprovalGranted'])
  const grantedIds = new Set(
    granted.map((g) => String((g.payload as any)?.approvalId ?? '')).filter(Boolean),
  )
  return requested.filter((r) => {
    const id = String((r.payload as any)?.approvalId ?? '')
    return id && !grantedIds.has(id)
  }).length
}
