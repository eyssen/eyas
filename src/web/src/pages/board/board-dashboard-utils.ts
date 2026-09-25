// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BoardStage } from '@/stores/board-store'
import type { AgentRunSnapshot } from '@/pages/mission-control/hooks/useMissionControl'

/** Priority buckets that are always present, so a stacked bar keeps a stable series order. */
export const PRIORITY_KEYS = ['urgent', 'high', 'normal', 'low'] as const

/**
 * Conversation statuses that count as active work. `waiting` (waiting for a
 * reply) is included: the task is still being worked, just not by us.
 * `waiting_approval` (D6) is likewise still in flight — paused pending an
 * operator decision, not finished.
 */
export const WIP_STATUSES: readonly string[] = ['working', 'waiting', 'waiting_approval']

export interface DerivedCounts {
  open: number
  doneToday: number
  wip: number
  byPriority: Record<string, number>
}

export interface ThroughputBucket {
  date: string
  count: number
}

export interface StageCount {
  name: string
  color: string | null
  count: number
}

export type ActivityKind = 'conversation' | 'agent'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  title: string | null
  detail: string | null
  status: string
  timestamp: number
  conversationId: string | null
}

function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Local-calendar day key. Buckets follow the viewer's day boundaries, not UTC. */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function isSameDay(a: number, b: number): boolean {
  return dayKey(new Date(a)) === dayKey(new Date(b))
}

/**
 * A conversation counts as "done today" when it sits in a closed stage *and*
 * was last updated on the same calendar day as `now`. The board carries no
 * completion timestamp of its own, so the move into the closed stage — which
 * bumps updatedAt — is the best available proxy for "finished today".
 */
export function deriveCounts(stages: BoardStage[], now: number): DerivedCounts {
  const byPriority: Record<string, number> = {}
  for (const key of PRIORITY_KEYS) byPriority[key] = 0

  let open = 0
  let doneToday = 0
  let wip = 0

  for (const stage of stages) {
    for (const conv of stage.conversations) {
      byPriority[conv.priority] = (byPriority[conv.priority] ?? 0) + 1
      if (stage.isClosed) {
        const ts = parseTs(conv.updatedAt)
        if (ts !== null && isSameDay(ts, now)) doneToday++
      } else {
        open++
        if (WIP_STATUSES.includes(conv.status)) wip++
      }
    }
  }

  return { open, doneToday, wip, byPriority }
}

/**
 * Conversations updated per day over the trailing `days` window, oldest→newest.
 * The last bucket is always the day of `now`; days without activity stay at 0.
 */
export function throughputBuckets(stages: BoardStage[], days: number, now: number): ThroughputBucket[] {
  if (days <= 0) return []

  const buckets: ThroughputBucket[] = []
  const indexByDay = new Map<string, number>()

  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  // setDate() walks calendar days, so a DST change inside the window cannot
  // drift the buckets the way subtracting fixed 24h spans would.
  cursor.setDate(cursor.getDate() - (days - 1))

  for (let i = 0; i < days; i++) {
    const key = dayKey(cursor)
    indexByDay.set(key, i)
    buckets.push({ date: key, count: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  for (const stage of stages) {
    for (const conv of stage.conversations) {
      const ts = parseTs(conv.updatedAt)
      if (ts === null) continue
      const i = indexByDay.get(dayKey(new Date(ts)))
      if (i !== undefined) buckets[i].count++
    }
  }

  return buckets
}

export function perStageCounts(stages: BoardStage[]): StageCount[] {
  return stages.map((stage) => ({
    name: stage.name,
    color: stage.color,
    count: stage.conversations.length,
  }))
}

/**
 * Conversation updates and live agent actions on one newest-first timeline.
 * Ties break on id so the feed does not reshuffle between renders.
 */
export function mergeActivity(
  stages: BoardStage[],
  agents: AgentRunSnapshot[],
  limit: number,
): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const stage of stages) {
    for (const conv of stage.conversations) {
      const ts = parseTs(conv.updatedAt)
      if (ts === null) continue
      items.push({
        id: `conv:${conv.id}`,
        kind: 'conversation',
        title: conv.title,
        detail: stage.name,
        status: conv.status,
        timestamp: ts,
        conversationId: conv.id,
      })
    }
  }

  for (const agent of agents) {
    if (!agent.currentAction) continue
    items.push({
      id: `agent:${agent.sessionId}`,
      kind: 'agent',
      title: agent.agentName,
      detail: agent.currentAction,
      status: agent.status,
      timestamp: agent.lastUpdatedAt,
      conversationId: agent.sessionId,
    })
  }

  items.sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))
  return items.slice(0, Math.max(0, limit))
}
