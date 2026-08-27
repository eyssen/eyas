// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from '@/hooks/use-websocket'
import { api, ApiError } from '@/lib/api'
import { createLatestOnlyGate } from '@/lib/latest-only-gate'
import { WS_TOPICS } from '@/lib/ws-topics'

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentRunSnapshot {
  sessionId: string
  agentId: string
  agentName: string
  ownerUserId: string
  status: AgentRunStatus
  startedAt: number
  lastUpdatedAt: number
  currentTurn: number
  maxTurns: number
  tokensUsed: number
  tokensBudget: number
  costUsd: number
  currentAction: string | null
  lastEventType: string | null
  pendingApprovals: number
  team?: { teamSessionId: string; role: string }
  parentSessionId?: string
}

export interface MissionControlSnapshot {
  timestamp: number
  agents: AgentRunSnapshot[]
  totals: {
    running: number
    waiting: number
    completedToday: number
    costTodayUsd: number
  }
}

export type ConnectionState = 'connecting' | 'open' | 'closed'

export interface UseMissionControlResult {
  snapshot: MissionControlSnapshot | null
  connection: ConnectionState
  error: string | null
}

/**
 * Latest Mission Control snapshot, kept fresh over the app's shared WebSocket.
 *
 * The snapshot itself never rides the socket: WS topic subscription is
 * authenticated but NOT permission-scoped, so a snapshot frame would hand every
 * logged-in user every other user's runs. The backend pushes a THIN ping on
 * `mission-control` (already throttled aggregator-side) and this hook refetches
 * the CASL-filtered REST snapshot — which is where the per-owner filter lives.
 *
 * A reconnect also refetches: pings broadcast while the socket was down are
 * gone, so the ping alone would leave the page showing a stale snapshot.
 */
export function useMissionControl(
  snapshotPath = '/mission-control/snapshot',
): UseMissionControlResult {
  const { subscribe, connected } = useWebSocket()
  const [snapshot, setSnapshot] = useState<MissionControlSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Three triggers (mount, reconnect, ping) can each have a fetch in flight, so
  // ordering needs a ticket per request — a cancellation flag alone would let a
  // slow older response overwrite a newer snapshot. See createLatestOnlyGate.
  const gateRef = useRef(createLatestOnlyGate())

  const load = useCallback(async (isCancelled: () => boolean) => {
    const gate = gateRef.current
    const ticket = gate.issue()
    try {
      const next = await api.get<MissionControlSnapshot>(snapshotPath)
      if (isCancelled() || !gate.accept(ticket)) return
      setSnapshot(next)
      setError(null)
    } catch (e) {
      if (isCancelled() || !gate.accept(ticket)) return
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }, [snapshotPath])

  // `connected` in the deps is the reconnect catch-up: the socket coming up
  // (or going down) re-syncs against REST. The `cancelled` flag is per effect
  // RUN, so a superseded run can never write after its cleanup.
  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
  }, [load, connected])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = subscribe(WS_TOPICS.missionControl, () => { void load(() => cancelled) })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [subscribe, load])

  // The shared hook reconnects on its own, so a closed socket is always a
  // "connecting" one from the page's point of view; 'closed' stays in the union
  // for consumers that switch on it exhaustively.
  return { snapshot, connection: connected ? 'open' : 'connecting', error }
}
