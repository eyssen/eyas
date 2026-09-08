// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

/**
 * Inter-agent messaging. Both tools are scoped by `ToolContext.sessionId`,
 * which the agent runner threads in for a supervised run — outside one there
 * is no team to talk to, so they fail soft rather than writing rows under a
 * fabricated session key.
 */
export function createAgentMessagingTools(messaging: any): ToolImplementation[] {
  return [
    {
      name: 'send_agent_message',
      description: 'Send a message to another agent in the current team. Use for sharing discoveries, asking questions, or coordinating work.',
      category: 'conversation',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          toAgent: { type: 'string', description: 'Target agent ID. Use "broadcast" to send to all agents.' },
          content: { type: 'string', description: 'Message content' },
        },
        required: ['toAgent', 'content'],
      },
      execute: async (input, ctx) => {
        const sessionId = ctx?.sessionId
        if (!sessionId) {
          return { error: 'No active session for messaging — this tool only works inside a supervised agent run' }
        }

        const to = input.toAgent === 'broadcast' ? null : input.toAgent as string
        const msg = messaging.send(sessionId, ctx.agentId ?? 'unknown', to, input.content as string)
        return { sent: true, messageId: msg.id }
      },
    },
    {
      name: 'read_agent_messages',
      description: 'Read messages from other agents directed to you or broadcast to the team.',
      category: 'conversation',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          sinceId: { type: 'number', description: 'Only get messages after this ID (optional)' },
        },
      },
      execute: async (input, ctx) => {
        const sessionId = ctx?.sessionId
        if (!sessionId) return { messages: [] }

        const messages = messaging.getForAgent(sessionId, ctx.agentId ?? 'unknown', input.sinceId as number)
        return { messages }
      },
    },
  ]
}
