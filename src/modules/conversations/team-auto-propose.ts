// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * First-turn team auto-proposal / soft-nudge policy.
 *
 * Conversation create itself does NOT propose a team. On the first user
 * message (or an explicit team request later) we either:
 *   - fire `analyzeAndPropose` in the background → TeamProposalCard (user still approves), or
 *   - inject a soft system nudge so the model may call `propose_team` itself.
 *
 * Solo orchestration is always a no-op.
 */

import type { TaskComplexity } from '@modules/model/routing/types.js'
import { keywordTriage } from '@modules/model/routing/triage.js'
import { WS_TOPICS } from '@shared/ws-topics.js'

export type TeamAutoAction = 'none' | 'propose' | 'nudge'

export interface TeamAutoDecision {
  action: TeamAutoAction
  complexity: TaskComplexity
  reason: string
}

export interface TeamAutoDecideInput {
  orchestration: string | null | undefined
  /** User messages already in the conversation INCLUDING the just-saved one. */
  userMessageCount: number
  complexity: TaskComplexity | string
  hasActiveTeamSession: boolean
  message: string
}

/** Explicit user asks for a team / multi-agent run. */
const EXPLICIT_TEAM = /(?:\bteam\b|csapat|multi[-\s]?agent|sub[-\s]?agent|propose[_\s-]?team|\/team\b)/i

/** Multi-step / multi-domain signals that bump moderate → propose. */
const MULTI_STEP = /(?:\b\d+\.\s|\bstep\b|\blépés\b|\bphase\b|\bfázis\b|\band then\b|\bmajd\b|\bés\b.+\bés\b)/i

const ACTIVE_TEAM_STATUSES = new Set(['proposing', 'awaiting_approval', 'running', 'paused'])

export function isActiveTeamStatus(status: string): boolean {
  return ACTIVE_TEAM_STATUSES.has(status)
}

export function hasExplicitTeamRequest(message: string): boolean {
  return EXPLICIT_TEAM.test(message)
}

/**
 * Map routing triage complexity into the propose_team enum
 * (`simple` | `moderate` | `complex` | `epic`).
 */
export function toProposeComplexity(complexity: string): 'simple' | 'moderate' | 'complex' | 'epic' {
  switch (complexity) {
    case 'trivial':
    case 'simple':
      return 'simple'
    case 'moderate':
      return 'moderate'
    case 'expert':
      return 'epic'
    case 'complex':
    default:
      return complexity === 'complex' ? 'complex' : 'moderate'
  }
}

/**
 * Zero-cost complexity estimate for the auto-propose gate.
 * Reuses keyword triage so we don't double-bill the triage LLM when the
 * decision engine already ran (callers may pass a known complexity instead).
 */
export function estimateMessageComplexity(message: string): TaskComplexity {
  return keywordTriage(message).complexity
}

export function decideTeamAutoPropose(input: TeamAutoDecideInput): TeamAutoDecision {
  const orchestration = (input.orchestration ?? 'auto').toLowerCase()
  const complexity = (input.complexity || 'moderate') as TaskComplexity
  const explicit = hasExplicitTeamRequest(input.message)

  if (input.hasActiveTeamSession) {
    return { action: 'none', complexity, reason: 'active team session already exists' }
  }

  if (orchestration === 'solo') {
    return { action: 'none', complexity, reason: 'orchestration is solo' }
  }

  // Explicit request: any turn, any non-solo mode.
  if (explicit) {
    return {
      action: 'propose',
      complexity: complexity === 'trivial' || complexity === 'simple' ? 'moderate' : complexity,
      reason: 'explicit team request in message',
    }
  }

  // Auto-propose only on the first user turn (conversation start path).
  if (input.userMessageCount !== 1) {
    return { action: 'none', complexity, reason: 'not first user message' }
  }

  if (orchestration === 'deep') {
    if (complexity === 'trivial' || complexity === 'simple') {
      return { action: 'nudge', complexity, reason: 'deep mode + light task — soft nudge only' }
    }
    return { action: 'propose', complexity, reason: 'deep orchestration + non-trivial first message' }
  }

  // auto (default)
  if (complexity === 'complex' || complexity === 'expert') {
    return { action: 'propose', complexity, reason: 'auto mode + complex/expert first message' }
  }

  if (complexity === 'moderate' && (input.message.length >= 400 || MULTI_STEP.test(input.message))) {
    return { action: 'propose', complexity, reason: 'auto mode + multi-step moderate first message' }
  }

  if (complexity === 'moderate') {
    return { action: 'nudge', complexity, reason: 'auto mode + moderate — soft nudge' }
  }

  return { action: 'none', complexity, reason: 'simple task — stay solo' }
}

/** System-prompt fragment when we only nudge (no card yet). */
export function buildTeamNudgeDirective(complexity: string, reason: string): string {
  return [
    'Team orchestration hint:',
    `This first message looks ${complexity} (${reason}).`,
    'If the work would benefit from specialist agents, call `propose_team` early with a clear goalDescription and complexity estimate instead of doing everything inline.',
    'If the task is a single short answer, continue solo.',
  ].join(' ')
}

/** System-prompt fragment when a proposal card is already being prepared. */
export function buildTeamProposeInFlightDirective(): string {
  return [
    'A multi-agent team proposal is being prepared for the user (TeamProposalCard).',
    'Do NOT call `propose_team` again for this task unless the user rejects the proposal or asks to revise it.',
    'You may answer clarifying questions while they decide; do not start a parallel unofficial team.',
  ].join(' ')
}

export interface TeamProposeDeps {
  orchestrator: {
    analyzeAndPropose(
      goalDescription: string,
      complexity: string,
    ): Promise<{
      config: unknown
      reasoning: string
      estimatedTokens: number
      estimatedCostUsd: number
      agentGaps: unknown[]
    }>
  }
  teamSessions: {
    create(
      parentConversationId: string,
      input: {
        config: unknown
        reasoning: string
        estimatedTokens: number
        goalDescription?: string
      },
    ): { id: string; parentConversationId: string; [k: string]: unknown }
    listByConversation(parentConversationId: string): { status: string }[]
  }
  bus?: { emit(subject: string, data: unknown): void }
  wsBroadcast?: (topic: string, message: unknown) => void
  logger?: { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void }
}

/**
 * Same payload shape as POST /conversations/:id/team/propose and the
 * `propose_team` tool — keeps TeamProposalCard identical across entry points.
 */
export async function fireTeamProposal(
  deps: TeamProposeDeps,
  conversationId: string,
  goalDescription: string,
  complexity: string,
): Promise<{ sessionId: string } | null> {
  try {
    const existing = deps.teamSessions.listByConversation(conversationId)
    if (existing.some((s) => isActiveTeamStatus(s.status))) {
      deps.logger?.info({ conversationId }, 'team auto-propose skipped: active session exists')
      return null
    }

    const proposal = await deps.orchestrator.analyzeAndPropose(
      goalDescription,
      toProposeComplexity(complexity),
    )
    const session = deps.teamSessions.create(conversationId, {
      config: proposal.config,
      reasoning: proposal.reasoning,
      estimatedTokens: proposal.estimatedTokens,
      goalDescription,
    })

    // Same renderable shape as POST /team/propose and the propose_team tool.
    const phases = Array.isArray((proposal.config as { phases?: unknown }).phases)
      ? (proposal.config as { phases: unknown[] }).phases
      : []
    const cardPayload = {
      session,
      proposal: {
        phases,
        estimatedTokens: proposal.estimatedTokens,
        estimatedCostUsd: proposal.estimatedCostUsd,
        reasoning: proposal.reasoning,
        agentGaps: proposal.agentGaps,
      },
    }

    deps.bus?.emit(`team:${session.id}:proposed`, { session, proposal: cardPayload.proposal })
    deps.bus?.emit(`team:proposed:${conversationId}`, cardPayload)
    deps.wsBroadcast?.(WS_TOPICS.teamProposed(conversationId), {
      event: 'team:proposed',
      data: cardPayload,
    })

    deps.logger?.info(
      { conversationId, sessionId: session.id, complexity },
      'team auto-propose: proposal broadcast',
    )
    return { sessionId: session.id }
  } catch (err) {
    deps.logger?.warn({ err, conversationId }, 'team auto-propose failed')
    return null
  }
}
