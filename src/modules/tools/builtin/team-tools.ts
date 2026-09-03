// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '../types.js'
import type { TeamSessionService } from '@modules/agent/team-session-service.js'
import type { createOrchestrator } from '@modules/agent/orchestrator.js'
import { WS_TOPICS } from '@shared/ws-topics.js'

/**
 * Direct WS push (the module wires a lazy ctx.wsRegistry shim). Team updates
 * produced INSIDE a tool-use loop have no other route to the browser: the
 * `team:*` colon subjects are legacy bus traffic with no bridge mapping.
 */
export type TeamWsBroadcast = (topic: string, message: unknown) => void

export function createTeamTools(
  teamSessions: TeamSessionService,
  wsBroadcast?: TeamWsBroadcast,
): ToolImplementation[] {
  return [
    {
      name: 'write_team_memory',
      description: 'Write a finding, decision, blocker, or question to the shared team memory. Other agents in the team can read it.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Unique identifier for this memory entry, e.g. "security-finding-001"' },
          value: { type: 'string', description: 'The content to store. Objects should be JSON-serialized strings.' },
          category: { type: 'string', enum: ['finding', 'decision', 'blocker', 'question', 'fact'], description: 'Category of this memory entry' },
          visibility: { type: 'string', description: 'Who can read this: "all" (default) or "role:engineer", "role:reviewer", etc.' },
        },
        required: ['key', 'value', 'category'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const teamSessionId = ctx?.teamSessionId
        if (!teamSessionId) {
          return {
            error: 'No active team session. Call `propose_team` first to create a team session, then this tool will have a session id to write into.',
          }
        }

        const entry = teamSessions.writeMemory(teamSessionId, {
          key: input.key as string,
          value: input.value,
          layer: 'agent',
          category: input.category as any,
          authorAgentId: ctx?.agentId ?? undefined,
          visibility: input.visibility as string | undefined,
        })
        wsBroadcast?.(WS_TOPICS.teamEvent(teamSessionId), { event: 'team', data: { type: 'memory_written', entry } })
        return { written: true, entryId: entry.id, key: entry.key }
      },
    },
    {
      name: 'read_team_memory',
      description: 'Read shared team memory entries. Filter by category or key to get relevant context from other agents.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['finding', 'decision', 'blocker', 'question', 'fact'], description: 'Filter by category (optional)' },
          key: { type: 'string', description: 'Filter by exact key (optional)' },
        },
      },
      execute: async (input, ctx?: ToolContext) => {
        const teamSessionId = ctx?.teamSessionId
        if (!teamSessionId) return { entries: [] }

        const agentRole = ctx?.agentRole
        const entries = teamSessions.readMemory(teamSessionId, {
          category: input.category as string | undefined,
          key: input.key as string | undefined,
          agentRole,
        })
        return {
          entries: entries.map(e => ({
            key: e.key,
            category: e.category,
            value: (() => { try { return JSON.parse(e.value) } catch { return e.value } })(),
            author: e.authorAgentId ?? 'system',
            createdAt: e.createdAt,
          })),
        }
      },
    },
  ]
}

export function createProposeTeamTool(
  orchestrator: ReturnType<typeof createOrchestrator>,
  teamSessions: TeamSessionService,
  bus?: { emit(subject: string, data: unknown): void },
  wsBroadcast?: TeamWsBroadcast,
): ToolImplementation[] {
  return [
    {
      name: 'propose_team',
      description: 'Analyze the current task and propose a team of agents to tackle it collaboratively. Call this when a task is complex enough to benefit from multiple specialized agents. The user will see the proposal and can approve, modify, or reject it.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          goalDescription: { type: 'string', description: 'Clear description of the task to be accomplished' },
          complexity: { type: 'string', enum: ['simple', 'moderate', 'complex', 'epic'], description: 'Estimated task complexity' },
        },
        required: ['goalDescription', 'complexity'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const conversationId = ctx?.conversationId
        if (!conversationId) return { error: 'No conversation context — cannot propose team' }

        const proposal = await orchestrator.analyzeAndPropose(
          input.goalDescription as string,
          input.complexity as string,
        )

        const session = teamSessions.create(conversationId, {
          config: proposal.config,
          reasoning: proposal.reasoning,
          estimatedTokens: proposal.estimatedTokens,
        })

        // Propagate the new session id onto the shared tool context so
        // subsequent write_team_memory / read_team_memory calls in this
        // tool-use loop resolve it automatically.
        if (ctx && !ctx.teamSessionId) {
          ctx.teamSessionId = session.id
        }

        // Same renderable shape the REST propose route pushes, so the proposal
        // card looks identical whether the team came from chat or from the API.
        const proposedPayload = {
          session,
          proposal: {
            phases: proposal.config.phases,
            estimatedTokens: proposal.estimatedTokens,
            estimatedCostUsd: proposal.estimatedCostUsd,
            reasoning: proposal.reasoning,
            agentGaps: proposal.agentGaps,
          },
        }
        bus?.emit(`team:proposed:${conversationId}`, proposedPayload)
        wsBroadcast?.(WS_TOPICS.teamProposed(conversationId), { event: 'team:proposed', data: proposedPayload })

        return {
          teamSessionId: session.id,
          proposal: {
            phases: proposal.config.phases,
            estimatedTokens: proposal.estimatedTokens,
            estimatedCostUsd: proposal.estimatedCostUsd,
            reasoning: proposal.reasoning,
          },
          agentGaps: proposal.agentGaps,
          message: `Team proposal created. The user will see this proposal and can approve or modify it.`,
        }
      },
    },
  ]
}
