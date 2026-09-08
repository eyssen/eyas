// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TeamSessionState } from '@/stores/team-session-store'

/** A persisted team session as GET /conversations/:id/team-sessions returns it. */
export interface PersistedTeamSession {
  id: string
  parentConversationId: string | null
  status: TeamSessionState['status']
  config: string
  reasoning: string | null
  estimatedTokens: number
}

/**
 * Rough $/token for the reload-rendered proposal card. A live proposal carries
 * a cost the orchestrator computed from real model prices, but only the token
 * estimate is persisted — so after a reload the card shows an
 * order-of-magnitude figure instead of an empty slot.
 */
const COST_PER_TOKEN_USD = 0.000003

/** Statuses with nothing left to run. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed'])

/**
 * Which of a conversation's sessions the page attaches to. Sessions arrive
 * newest-first: prefer the newest still-live one, else fall back to the newest
 * finished one so a completed run's rails (run tree, memory) still come back.
 *
 * `linkedTeamSessionId` is the conversation's own `teamSessionId` stamp, and it
 * is what makes a REJECTED session stay rejected: reject() nulls that column,
 * so a 'failed' session the conversation no longer points at is a session the
 * user dismissed — re-attaching it would resurrect a card they closed. A
 * 'failed' session is therefore only used as the fallback while the stamp still
 * names it. Pass null when the stamp is unknown: skipping is the safe default.
 */
export function pickHydratableSession(
  sessions: PersistedTeamSession[] | undefined | null,
  linkedTeamSessionId?: string | null,
): PersistedTeamSession | null {
  if (!sessions || sessions.length === 0) return null
  const live = sessions.find(s => !TERMINAL_STATUSES.has(String(s.status)))
  if (live) return live
  const newest = sessions[0]
  if (newest.status === 'failed' && newest.id !== linkedTeamSessionId) return null
  return newest
}

type ProposalPhase = { name: string; agents: string[]; parallel: boolean }

/**
 * Structural check on one persisted phase. `name` and `agents` are what the
 * card actually renders, so a malformed element there is fatal; `parallel` is
 * a display flag and is coerced rather than required, so a config row written
 * before that field existed still renders.
 */
function isPhaseShaped(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const phase = value as Record<string, unknown>
  if (typeof phase.name !== 'string') return false
  return Array.isArray(phase.agents) && phase.agents.every(a => typeof a === 'string')
}

/**
 * Rebuild the renderable proposal from the session row. The agent-gap analysis
 * is never persisted, so it comes back empty and the card renders without it.
 * Returns null when the stored config can't produce well-formed phases — better
 * a plain page than a card rendering `[object Object]` at the user.
 */
export function buildProposalFromSession(
  session: PersistedTeamSession,
): TeamSessionState['proposal'] {
  let phases: ProposalPhase[]
  try {
    const config = JSON.parse(session.config) as { phases?: unknown }
    if (!Array.isArray(config?.phases)) return null
    if (!config.phases.every(isPhaseShaped)) return null
    phases = config.phases.map((p: any) => ({
      name: p.name,
      agents: p.agents,
      parallel: p.parallel === true,
    }))
  } catch {
    return null
  }
  const estimatedTokens = session.estimatedTokens ?? 0
  return {
    phases,
    estimatedTokens,
    estimatedCostUsd: estimatedTokens * COST_PER_TOKEN_USD,
    reasoning: session.reasoning ?? '',
    agentGaps: [],
  }
}
