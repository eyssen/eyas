// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { ToolImplementation, ToolContext } from '../types.js'
import type { AgentRegistry } from '@modules/agent/agent-registry.js'
import type { ConversationService } from '@modules/conversations/conversation-service.js'
import { isColleagueTier } from './delegate-tool.js'

export interface HandoffToolDeps {
  getConversations: () => ConversationService | undefined
  registry?: AgentRegistry
  bus?: EyasBus
}

export function createHandoffTool(deps: HandoffToolDeps): ToolImplementation[] {
  return [
    {
      name: 'handoff_to_colleague',
      description:
        'Pass this conversation to another colleague (primary or team). Opens their home thread with your summary and starts them. Use run_specialist for a specialist, assign_task for a background board card.',
      category: 'agent',
      riskTier: 'green',
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'ID of the colleague (primary or team) — the id field, not the name' },
          reason: { type: 'string', description: 'Why this is their job, one sentence' },
          summary: { type: 'string', description: 'Brief the colleague needs to continue' },
        },
        required: ['agentId', 'reason', 'summary'],
      },
      execute: async (input: Record<string, unknown>, ctx?: ToolContext) => {
        const agentId = String(input.agentId ?? '')
        const reason = String(input.reason ?? '')
        const summary = String(input.summary ?? '')
        const conversations = deps.getConversations()
        const conversationId = ctx?.conversationId ?? ''

        if (!conversations) {
          return { error: 'Conversations module not ready yet — try again shortly' }
        }
        if (!conversationId) {
          return { error: 'No conversation context — cannot hand off' }
        }
        if (!agentId || !summary.trim()) {
          return { error: 'agentId and summary are required' }
        }

        const parent = conversations.get(conversationId)
        if (!parent) {
          return { error: `Conversation not found: ${conversationId}` }
        }

        if (deps.registry) {
          const def = deps.registry.get(agentId)
          if (!def) {
            const available = deps.registry.list({ enabled: true })
              .filter(a => isColleagueTier(a.tier))
              .map(a => ({ id: a.id, name: a.name, tier: a.tier }))
            return {
              error: `Agent id "${agentId}" not found. Use a colleague id from the roster (primary or team). For a specialist, call run_specialist.`,
              availableAgents: available,
            }
          }
          if (!def.enabled) {
            return { error: `Agent "${def.name}" (${agentId}) is not enabled.` }
          }
          if (!isColleagueTier(def.tier)) {
            return {
              error: `"${def.name}" (${agentId}) is a specialist. Call run_specialist with a self-contained brief instead of handing off the conversation.`,
            }
          }
          if (agentId === ctx?.agentId) {
            return { error: 'Cannot hand off to yourself. Do the work, or run_specialist / assign_task.' }
          }

          const ownerUserId = parent.userId === 'system' ? (ctx?.userId ?? parent.userId) : parent.userId
          const home = conversations.getOrCreateHomeThread({
            userId: ownerUserId,
            agentId,
            title: def.name,
            projectId: parent.projectId,
            providerId: parent.providerId,
            modelId: parent.modelId,
          })
          const brief = `${summary.trim()}\n\n(Handed off from ${ctx?.agentId ?? 'colleague'}: ${reason.trim() || 'owns this work'})`
          conversations.update(home.id, { goalDescription: brief, status: 'waiting' })
          conversations.addMessage(home.id, { role: 'user', content: brief })
          deps.bus?.emit('eyas.board.task_assigned', {
            conversationId: home.id,
            targetId: home.id,
            projectId: home.projectId ?? null,
            agentId,
            assignedByAgentId: ctx?.agentId ?? null,
            userId: home.userId,
            handoffFromConversationId: conversationId,
          })
          return {
            handedOff: true,
            conversationId: home.id,
            agentId,
            agentName: def.name,
            reason: reason.trim(),
          }
        }

        return { error: 'Agent registry is not available — cannot hand off' }
      },
    },
  ]
}
