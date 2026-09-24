// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type {
  AgentRunStatus,
  AgentSessionEntry,
  AgentSessionRegistry,
} from '@modules/mission-control/types.js'
import type { RunSupervisor } from './run-supervisor.js'

/**
 * AgentSessionRegistry over the real `agent_sessions` table.
 *
 * Mission Control talks to agent runs exclusively through this port. Until it
 * was implemented the module fell back to an empty in-memory registry, so the
 * dashboard rendered "no agents" while runs were actually in flight.
 *
 * Ownership comes from the run's conversation (agent_sessions has no user
 * column). An unresolvable owner is reported as '' — the routes compare it to
 * the caller's user id, so an unknown owner fails CLOSED (admins only).
 */

/** Only the fields this adapter reads off an agent definition. */
export interface AgentDefinitionLookup {
  get(id: string): { name?: string; maxTurns?: number; monthlyTokenBudget?: number } | undefined
}

export interface AgentSessionRegistryAdapterDeps {
  db: any
  /** Cancellation is an in-process operation — the supervisor owns the AbortController. */
  supervisor: Pick<RunSupervisor, 'cancel'>
  /** Optional: resolves display name / limits. Falls back to the agent id. */
  agents?: AgentDefinitionLookup
}

interface SessionRow {
  id: string
  agent_id: string
  conversation_id: string
  status: string
  started_at: string
  turns_used: number | null
  tokens_used: number | null
  cost_usd: number | null
  user_id: string | null
  parent_conversation_id: string | null
}

/** Sentinel userId orchestrator/executeAgent stamp onto team/delegation child conversations (F0 R4). */
const SYSTEM_OWNER = 'system'
/** Cycle/runaway guard for the ancestor walk — mirrors resumeRun's lineage-chain cap (conversation-runner.ts). */
const MAX_ANCESTOR_HOPS = 50

/** Statuses that still represent a live run (everything else is terminal). */
const ACTIVE_STATUSES = ['running', 'stuck', 'refreshing', 'paused', 'waiting_approval']
const ACTIVE_STATUS_LIST = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * agent_sessions carries supervisor-internal states the dashboard vocabulary
 * has no word for: 'stuck' (detected stall, kill in flight) and 'refreshing'
 * (checkpoint resume) are both still-executing runs, so they read as running.
 */
function toRunStatus(status: string): AgentRunStatus {
  switch (status) {
    case 'stuck':
    case 'refreshing':
      return 'running'
    // 'max_turns' is a terminal agent_sessions-only status (D6) — mission
    // control's AgentRunStatus has no dedicated slot for it (this dashboard
    // only cares whether the run is still live), so it reads as 'completed'
    // like any other finished run. It never reaches list() anyway: that query
    // filters to ACTIVE_STATUSES, which 'max_turns' is not part of.
    case 'max_turns':
      return 'completed'
    case 'running':
    case 'paused':
    case 'waiting_approval':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'idle':
      return status as AgentRunStatus
    default:
      return 'running'
  }
}

function toEpoch(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * S7 (F2 T4) — orchestrator.runAgentInConversation and executeAgent create
 * child conversations with userId 'system' (team/delegation runs have no
 * human directly at the keyboard — orchestrator.ts, agent/index.ts).
 * Resolving straight off `conversations.user_id` would surface every such
 * run with owner 'system', which every human owner's Mission Control view
 * treats as unresolvable/foreign — the run would vanish from ALL dashboards.
 *
 * Walks `parent_conversation_id` upward (mirrors conversation-service's
 * getAncestry walk) until a non-'system', non-null owner is found — the
 * nearest human ancestor wins. Cycle-guarded + hop-capped like resumeRun's
 * lineage walk. Skipped entirely (zero extra queries) when the row's direct
 * owner is already human — the common case.
 */
export function resolveOwnerUserId(db: any, userId: string | null, parentConversationId: string | null): string {
  if (userId && userId !== SYSTEM_OWNER) return userId

  const visited = new Set<string>()
  let currentId = parentConversationId
  let hops = 0
  while (currentId && !visited.has(currentId) && hops < MAX_ANCESTOR_HOPS) {
    visited.add(currentId)
    hops++
    const rows = db.all(
      sql`SELECT user_id, parent_conversation_id FROM conversations WHERE id = ${currentId}`,
    ) as Array<{ user_id: string | null; parent_conversation_id: string | null }>
    const row = rows[0]
    if (!row) break
    if (row.user_id && row.user_id !== SYSTEM_OWNER) return row.user_id
    currentId = row.parent_conversation_id
  }
  return ''
}

export function createAgentSessionRegistryAdapter(
  deps: AgentSessionRegistryAdapterDeps,
): AgentSessionRegistry {
  const { db, supervisor, agents } = deps

  const SELECT = sql`SELECT s.id, s.agent_id, s.conversation_id, s.status, s.started_at,
      s.turns_used, s.tokens_used, s.cost_usd, c.user_id, c.parent_conversation_id
    FROM agent_sessions s
    LEFT JOIN conversations c ON c.id = s.conversation_id`

  function toEntry(r: SessionRow): AgentSessionEntry {
    const def = agents?.get(r.agent_id)
    return {
      sessionId: r.id,
      agentId: r.agent_id,
      agentName: def?.name ?? r.agent_id,
      ownerUserId: resolveOwnerUserId(db, r.user_id, r.parent_conversation_id),
      status: toRunStatus(r.status),
      startedAt: toEpoch(r.started_at),
      currentTurn: r.turns_used ?? 0,
      maxTurns: def?.maxTurns ?? 0,
      tokensBudget: def?.monthlyTokenBudget ?? 0,
      tokensUsed: r.tokens_used ?? 0,
      costUsd: r.cost_usd ?? 0,
    }
  }

  return {
    list(): AgentSessionEntry[] {
      // Fail soft: mission-control is a read-only dashboard, and the agent
      // module may not have created its tables yet (or at all, when disabled).
      try {
        const rows = db.all(
          sql`${SELECT} WHERE s.status IN (${sql.raw(ACTIVE_STATUS_LIST)}) ORDER BY s.started_at DESC`,
        ) as SessionRow[]
        return rows.map(toEntry)
      } catch {
        return []
      }
    },

    get(sessionId: string): AgentSessionEntry | undefined {
      try {
        const rows = db.all(sql`${SELECT} WHERE s.id = ${sessionId}`) as SessionRow[]
        return rows[0] ? toEntry(rows[0]) : undefined
      } catch {
        return undefined
      }
    },

    async interrupt(sessionId: string): Promise<void> {
      // Aborts the run's signal; the runner resolves it to 'cancelled' at its
      // next turn/tool boundary. A run this process isn't watching (crash
      // orphan, other node) has no controller to abort.
      if (!supervisor.cancel(sessionId)) {
        throw new Error(`run ${sessionId} is not active in this process`)
      }
    },

    async pause(): Promise<void> {
      throw new Error('pause is not supported for in-process agent runs — use interrupt')
    },

    async resume(): Promise<void> {
      throw new Error('resume is not supported for in-process agent runs — use retry/refresh')
    },
  }
}
