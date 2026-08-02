// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '../types.js'
import type { createDelegationService } from '@modules/agent/delegation.js'
import type { AgentRegistry } from '@modules/agent/agent-registry.js'

export function createDelegateTool(
  delegationService: ReturnType<typeof createDelegationService>,
  registry?: AgentRegistry,
): ToolImplementation[] {
  return [
    {
      name: 'delegate_to_agent',
      description: 'Delegate a task to another agent. Use when a task requires expertise outside your capabilities. The target agent will receive the task and context, execute it, and return a summary.',
      category: 'agent',
      riskTier: 'yellow',
      requiresApproval: true,
      // Child agents spin up their own Claude SDK run — allow up to 15 min
      // before treating the call as stuck. The child has its own maxTurns cap.
      timeoutMs: 15 * 60_000,
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'ID of the target agent (from agent directory)' },
          task: { type: 'string', description: 'Clear description of the task to delegate' },
          context: { type: 'string', description: 'Relevant context the target agent needs' },
        },
        required: ['agentId', 'task'],
      },
      execute: async (input: Record<string, unknown>, ctx?: ToolContext) => {
        const agentId = input.agentId as string
        const task = input.task as string
        const context = input.context as string | undefined
        const fullTask = context ? `${task}\n\nContext:\n${context}` : task
        const conversationId = ctx?.conversationId ?? ''

        if (!conversationId) {
          return { error: 'No conversation context — cannot delegate' }
        }

        // Hard validation: the agent must exist and be enabled. Slug strings
        // (e.g. "backend-developer") instead of agent IDs are the most common
        // coordinator mistake, and they silently fall through to a fallback
        // runner that does nothing useful. Fail loud and teach the coordinator.
        if (registry) {
          const def = registry.get(agentId)
          if (!def) {
            const available = registry.list({ enabled: true })
              .map(a => ({ id: a.id, name: a.name, tier: a.tier }))
            return {
              error: `Agent id "${agentId}" not found. Use one of the enabled agent IDs below (copy the id field, not the name/slug).`,
              availableAgents: available,
            }
          }
          if (!def.enabled) {
            return {
              error: `Agent "${def.name}" (${agentId}) is not enabled. If it is a pending proposal, ask the user to approve it in Settings → Agents before delegating.`,
            }
          }
        }

        try {
          const result = await delegationService.delegate(conversationId, agentId, fullTask)
          return {
            delegatedTo: agentId,
            childConversationId: result.conversationId,
            result: result.result,
          }
        } catch (err: any) {
          // Return the error as a normal tool result so the coordinator can
          // decide how to recover (e.g. propose a new agent, retry with
          // another target) instead of the whole turn failing hard.
          return { error: `Delegation failed: ${err?.message ?? String(err)}` }
        }
      },
    },
  ]
}
