// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

/** `getService` resolves `ctx.conversations`. */
export function createConversationTools(getService: () => any): ToolImplementation[] {
  const NOT_READY = { error: 'Conversations module not ready yet — try again shortly' }

  return [
    {
      name: 'create_sub_conversation',
      description: 'Create a child conversation for delegating a sub-task. The child inherits context from the parent.',
      category: 'conversation',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the sub-conversation' },
          goalDescription: { type: 'string', description: 'Description of what this sub-conversation should accomplish' },
          parentConversationId: { type: 'string', description: 'The parent conversation ID' },
          agentId: { type: 'string', description: 'Agent to assign to the sub-conversation (optional)' },
        },
        required: ['title', 'goalDescription', 'parentConversationId'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const parentConversationId = input.parentConversationId as string
        // createSubConversation throws on a missing parent; check first so the
        // agent gets an actionable in-band error rather than a stack trace.
        if (!service.get(parentConversationId)) {
          return { error: `Parent conversation not found: ${parentConversationId}` }
        }

        const conversation = service.createSubConversation({
          title: input.title as string,
          goalDescription: input.goalDescription as string,
          parentConversationId,
          agentId: input.agentId as string | undefined,
        })
        return { created: true, conversationId: conversation.id }
      },
    },
    {
      name: 'get_conversation_status',
      description: 'Check the current status of a conversation (idle, running, completed, archived, etc.).',
      category: 'conversation',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID to check' },
        },
        required: ['conversationId'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const conversationId = input.conversationId as string
        const conversation = service.get(conversationId)
        if (!conversation) return { error: `Conversation not found: ${conversationId}` }

        return {
          conversationId: conversation.id,
          status: conversation.status,
          title: conversation.title,
          agentId: conversation.agentId,
          stageId: conversation.stageId,
        }
      },
    },
  ]
}
