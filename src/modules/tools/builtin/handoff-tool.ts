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
          // The home thread is the colleague's: it follows the colleague's
          // model (else fixes the install default on its first turn), never
          // the handing-off conversation's pair.
          const home = conversations.getOrCreateHomeThread({
            userId: ownerUserId,
            agentId,
            title: def.name,
            projectId: parent.projectId,
          })
          // The hand-off starts a run in the home thread (agent/handoff-run.ts).
          // A thread with a run in progress (a chat turn, or an earlier
          // hand-off still working) is not re-armed: flipping it back to
          // 'waiting' would start a second run on the same thread.
          if (home.status === 'working' || home.status === 'waiting_approval') {
            return {
              error: `"${def.name}" (${agentId}) is busy with a run in their home thread. Try again when it finishes, or use assign_task for a background board card.`,
              busy: true,
              conversationId: home.id,
            }
          }
          const brief =`${summary.trim()}\n\n(Handed off from ${ctx?.agentId ?? 'colleague'}: ${reason.trim() || 'owns this work'})`
          conversations.update(home.id, { goalDescription: brief, status: 'waiting' })
          // The brief is the handing-off agent's text, not the owner's.
          conversations.addMessage(home.id, { role: 'user', content: brief, author: 'agent', entryPath: 'handoff' })
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
