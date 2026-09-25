// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Mission Control — live dashboard types.
 *
 * Shapes the aggregated snapshot of all currently-running agent sessions
 * (Cursor 2.0 grid view). Consumed by both REST and WebSocket endpoints.
 */

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentRunTeamInfo {
  teamSessionId: string
  role: string
}

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
  team?: AgentRunTeamInfo
  parentSessionId?: string
}

export interface MissionControlTotals {
  running: number
  waiting: number
  completedToday: number
  costTodayUsd: number
}

export interface MissionControlSnapshot {
  timestamp: number
  agents: AgentRunSnapshot[]
  totals: MissionControlTotals
}

/**
 * In-memory registry of running agent sessions. Provided by dependency
 * injection so mission-control never has to reach into the agent module.
 */
export interface AgentSessionRegistry {
  list(): AgentSessionEntry[]
  get(sessionId: string): AgentSessionEntry | undefined
  interrupt(sessionId: string): Promise<void>
  pause(sessionId: string): Promise<void>
  resume(sessionId: string): Promise<void>
}

export interface AgentSessionEntry {
  sessionId: string
  agentId: string
  agentName: string
  ownerUserId: string
  status: AgentRunStatus
  startedAt: number
  currentTurn: number
  maxTurns: number
  tokensBudget: number
  tokensUsed: number
  costUsd: number
  team?: AgentRunTeamInfo
  parentSessionId?: string
}

/**
 * Event bus subjects consumed by the aggregator.
 * Prefixed with `agent.session.` so we don't collide with other modules.
 */
export const AgentSessionBusSubjects = {
  Started: 'agent.session.started',
  ToolCalled: 'agent.session.tool_called',
  StateChanged: 'agent.session.state_changed',
  ApprovalRequested: 'agent.session.approval_requested',
  Completed: 'agent.session.completed',
  Failed: 'agent.session.failed',
  Cancelled: 'agent.session.cancelled',
} as const

export type AgentSessionBusSubject =
  (typeof AgentSessionBusSubjects)[keyof typeof AgentSessionBusSubjects]

// NOTE: the snapshot/delta WS frame types that used to live here described a
// dedicated Mission Control socket that pushed UNFILTERED snapshots. It was
// never wired to a route and has been removed — live updates are a thin
// `mission-control` ping plus a refetch of the owner-filtered REST snapshot.
