// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// THE loader of a run's effort intent (E4). Every entry path that runs a
// conversation — the chat route, background and resumed runs, team members,
// delegations and specialists, pipeline stages, channel replies and God Mode
// — asks it for the same thing, so they all resolve effort identically:
//
//   1. the conversation's own effort                → source 'conversation'
//   2. the conversation is Deep                     → 'max', source 'deep'
//   3. the agent the run speaks as has an effort    → source 'agent'
//   4. the nearest parent conversation that has one → that level, 'inherited'
//
// The precedence itself is pickEffortIntent's (model/reasoning/intent.ts);
// this file only reads the chain it is given: the conversation, then its
// delegating parents, nearest first, at most `maxDepth` conversations (one
// indexed SELECT each). The walk stops at the first conversation that
// decides, so a conversation with its own level costs one read. Nothing
// anywhere → undefined: the routing tier's or the model's own default
// applies, resolved by the gateway per model after routing.
//
// Stored values are untrusted: anything that is not a ladder rung is skipped
// (pickEffortIntent), and a read that fails counts as "nothing set here".

import { sql } from 'drizzle-orm'
import { pickEffortIntent, type EffortChainLink } from '@modules/model/reasoning/intent.js'
import type { EffortIntent } from '@modules/model/reasoning/ladder.js'

/** How far up the delegation chain a run looks for an effort (conversations read, the run's own included). */
export const EFFORT_CHAIN_MAX_DEPTH = 5

/** The database: only `all()` of a raw SQL select is used. */
export interface EffortIntentDb {
  all(query: ReturnType<typeof sql>): unknown
}

/** One conversation's effort columns, as stored (values unvalidated). */
export interface EffortConversationRow {
  effort?: unknown
  orchestration?: unknown
  agentId?: string | null
  parentConversationId?: string | null
}

export interface EffortIntentDeps {
  /**
   * The database (the conversations table). Absent: only the run's own
   * conversation counts, and only when the caller passes it as `self`.
   */
  db?: EffortIntentDb | null
  /** The agent registry lookup. Absent (or an unknown id): agents add no effort. */
  getAgent?: ((agentId: string) => { effort?: unknown } | null | undefined) | null
}

export interface LoadEffortIntentOptions {
  /**
   * The agent the run speaks as, when the caller knows it better than the
   * conversation row (the chat route's project default agent, a delegated
   * specialist, a channel's bound agent). null: the run speaks as no agent.
   * Absent: the row's agent_id.
   */
  agentId?: string | null
  /** The run's own conversation, when the caller already loaded it (saves one read). */
  self?: EffortConversationRow | null
  /** Conversations read at most, the run's own included. Default 5. */
  maxDepth?: number
}

interface StoredRow {
  effort: unknown
  orchestration: unknown
  agent_id: unknown
  parent_conversation_id: unknown
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function readConversation(db: EffortIntentDb | null | undefined, id: string): EffortConversationRow | null {
  if (!db) return null
  try {
    const rows = db.all(sql`
      SELECT effort, orchestration, agent_id, parent_conversation_id
      FROM conversations WHERE id = ${id}
    `) as StoredRow[] | undefined
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row) return null
    return {
      effort: row.effort,
      orchestration: row.orchestration,
      agentId: idOf(row.agent_id),
      parentConversationId: idOf(row.parent_conversation_id),
    }
  } catch {
    // An unreadable row sets nothing; the tier or model default applies.
    return null
  }
}

function agentEffortOf(getAgent: EffortIntentDeps['getAgent'], agentId: string | null | undefined): unknown {
  if (!agentId || !getAgent) return undefined
  try {
    return getAgent(agentId)?.effort
  } catch {
    return undefined
  }
}

/**
 * The effort intent of a run on `conversationId` (see the header for the
 * precedence). Pure reads, never throws.
 */
export function loadEffortIntent(
  deps: EffortIntentDeps,
  conversationId: string,
  options: LoadEffortIntentOptions = {},
): EffortIntent | undefined {
  const requested = options.maxDepth ?? EFFORT_CHAIN_MAX_DEPTH
  const maxDepth = Number.isInteger(requested) && requested > 0 ? requested : EFFORT_CHAIN_MAX_DEPTH
  const chain: EffortChainLink[] = []
  const seen = new Set<string>([conversationId])

  let row: EffortConversationRow | null = options.self ?? readConversation(deps.db, conversationId)
  for (let depth = 0; depth < maxDepth; depth++) {
    // The run's own link names the agent it speaks as; a parent's, its row's.
    const agentId = depth === 0 && options.agentId !== undefined ? options.agentId : row?.agentId
    const link: EffortChainLink = {
      effort: row?.effort,
      orchestration: row?.orchestration,
      agentEffort: agentEffortOf(deps.getAgent, agentId),
    }
    chain.push(link)
    // The nearest conversation that sets a level decides: read no further.
    if (pickEffortIntent([link])) break
    const parentId = row?.parentConversationId
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    row = readConversation(deps.db, parentId)
    if (!row) break
  }
  return pickEffortIntent(chain)
}
