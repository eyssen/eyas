// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Built-in handler for kind=agent_run jobs.
 * handlerConfig:
 * {
 *   agentId: string
 *   prompt: string
 *   conversationPolicy?: 'new' | 'reuse'
 *   conversationId?: string
 *   channelNotify?: string
 *   title?: string
 * }
 */

import type { Logger } from 'pino'

export interface AgentRunHandlerDeps {
  logger: Logger
  getAgent?: () => any
  getConversations?: () => any
  getCommunication?: () => any
}

export function createAgentRunHandler(deps: AgentRunHandlerDeps) {
  return async (config?: Record<string, unknown>) => {
    const agentId = String(config?.agentId ?? '')
    const prompt = String(config?.prompt ?? '')
    if (!agentId || !prompt) {
      throw new Error('agent_run requires handlerConfig.agentId and handlerConfig.prompt')
    }

    const conversations = deps.getConversations?.()
    const agent = deps.getAgent?.()
    if (!conversations?.create && !agent?.run) {
      throw new Error('Agent/conversations module unavailable for scheduled agent_run')
    }

    const title =
      (config?.title as string | undefined) ??
      `Scheduled: ${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}`

    let conversationId = config?.conversationId as string | undefined
    const policy = (config?.conversationPolicy as string) ?? 'new'

    if (policy === 'reuse' && conversationId && conversations?.get) {
      const existing = conversations.get(conversationId)
      if (!existing) conversationId = undefined
    }

    if (!conversationId && conversations?.create) {
      const conv = await conversations.create({
        title,
        agentId,
        // scheduled origin — board optional
      })
      conversationId = conv?.id ?? conv?.conversationId
    }

    // Prefer conversation-runner style kick if available
    if (conversations?.sendMessage && conversationId) {
      const result = await conversations.sendMessage(conversationId, {
        role: 'user',
        content: prompt,
        metadata: { origin: 'scheduled', autonomous: true },
      })
      return {
        conversationId,
        agentId,
        resultSummary: typeof result === 'string' ? result.slice(0, 500) : result,
      }
    }

    if (agent?.run) {
      const result = await agent.run({
        agentId,
        prompt,
        conversationId,
        origin: 'scheduled',
        autonomous: true,
      })
      return { conversationId, agentId, result }
    }

    throw new Error('No runnable agent path available')
  }
}
