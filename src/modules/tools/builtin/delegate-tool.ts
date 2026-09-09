// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '../types.js'
import type { createDelegationService } from '@modules/agent/delegation.js'
import type { AgentRegistry } from '@modules/agent/agent-registry.js'

export function isColleagueTier(tier: string | undefined): boolean {
  return tier === 'primary' || tier === 'team'
}

export interface DelegateToolOpts {
  /** First specialist spawn in a conversation without a team session. */
  ensureWorkSession?: (conversationId: string, memberIds: string[]) => void
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    agentId: { type: 'string', description: 'ID of the specialist (from the roster — the id field, not the name)' },
    task: { type: 'string', description: 'Clear, self-contained brief for the specialist' },
    context: { type: 'string', description: 'Relevant context the specialist needs' },
  },
  required: ['agentId', 'task'],
} as const

export function createDelegateTool(
  delegationService: ReturnType<typeof createDelegationService>,
  registry?: AgentRegistry,
  opts?: DelegateToolOpts,
): ToolImplementation[] {
  const execute = async (input: Record<string, unknown>, ctx?: ToolContext) => {
    const agentId = input.agentId as string
    const task = input.task as string
    const context = input.context as string | undefined
    const fullTask = context ? `${task}\n\nContext:\n${context}` : task
    const conversationId = ctx?.conversationId ?? ''

    if (!conversationId) {
      return { error: 'No conversation context — cannot delegate' }
    }

    if (registry) {
      const def = registry.get(agentId)
      if (!def) {
        const available = registry.list({ enabled: true })
          .filter(a => a.tier === 'specialist')
          .map(a => ({ id: a.id, name: a.name, tier: a.tier }))
        return {
          error: `Agent id "${agentId}" not found. Use one of the enabled specialist IDs below (copy the id field, not the name/slug). To pass work to a colleague, call handoff_to_colleague.`,
          availableAgents: available,
        }
      }
      if (!def.enabled) {
        return {
          error: `Agent "${def.name}" (${agentId}) is not enabled. If it is a pending proposal, ask the user to approve it in Settings → Agents before delegating.`,
        }
      }
      if (isColleagueTier(def.tier)) {
        return {
          error: `"${def.name}" (${agentId}) is a colleague (tier ${def.tier}), not a specialist. Call handoff_to_colleague to pass the conversation, or assign_task for asynchronous board work.`,
        }
      }
    }

    try {
      const members = [
        ctx?.agentId,
        agentId,
        ...(ctx?.pendingSpecialistIds ?? []),
      ].filter((id): id is string => Boolean(id))
      opts?.ensureWorkSession?.(conversationId, members)
      const result = await delegationService.delegate(conversationId, agentId, fullTask)
      return {
        delegatedTo: agentId,
        childConversationId: result.conversationId,
        result: result.result,
      }
    } catch (err: any) {
      return { error: `Delegation failed: ${err?.message ?? String(err)}` }
    }
  }

  const base = {
    description:
      'Run an enabled specialist on a self-contained brief and wait for the summary. Use for a single-domain slice you do not own. For another colleague (primary/team), call handoff_to_colleague. For background board work, call assign_task.',
    category: 'agent' as const,
    riskTier: 'green' as const,
    requiresApproval: false,
    timeoutMs: 15 * 60_000,
    inputSchema: INPUT_SCHEMA,
    execute,
  }

  return [
    { ...base, name: 'run_specialist' },
    {
      ...base,
      name: 'delegate_to_agent',
      description: `${base.description} Alias of run_specialist.`,
    },
  ]
}
