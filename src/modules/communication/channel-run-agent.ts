// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Adapts the agent runner to the inbound coordinator's runAgent contract: load
// the bound agent + conversation history, stream one run, accumulate the
// assistant reply, persist it, and return the text to send back on the channel.
//
// The conversation `mode` decides the `autonomous` flag: a channel message from
// a real user is interactive ('managed' → autonomous=false → governed by the
// security gate), while a 'autonomous' conversation routes through the autonomy
// ladder. This is the single place that mapping is made, so it can't drift.

import { toolWorkspaceFields } from '@modules/tools/working-directories.js'

export interface ChannelRunAgentDeps {
  agentRegistry: any
  agentRunner: any
  conversations: any
  toolRegistry: any
  logger: any
  /**
   * F2 T8 — routes token tracking through the budget engine (threshold-band
   * alerts) when wired; absent falls back to the bare `agentRegistry.addTokenUsage`
   * write, so every existing call site/test keeps working unchanged.
   */
  budgetEngine?: { trackUsage(agentId: string, tokens: number): void }
}

export interface ChannelRunInput {
  conversationId: string
  agentId: string | null
  mode: string
  signal?: AbortSignal
}

export function createChannelRunAgent(deps: ChannelRunAgentDeps) {
  return async function runAgent(input: ChannelRunInput): Promise<{ replyText: string | null }> {
    const { conversationId, agentId, mode, signal } = input

    const agent = agentId ? deps.agentRegistry?.get(agentId) : null
    if (!agent || agent.enabled === false) {
      deps.logger?.warn?.({ conversationId, agentId }, 'Channel run skipped: agent missing or disabled')
      return { replyText: null }
    }

    const conv = deps.conversations?.get(conversationId)
    const teamSessionId: string | undefined = conv?.teamSessionId ?? undefined
    const messages = (conv?.messages ?? []).map((m: any) => ({ role: m.role, content: m.content }))
    // Match conversation-runner / executeAgent: empty tools list ⇒ all registered tools.
    const tools =
      agent.tools && agent.tools.length > 0
        ? (deps.toolRegistry?.toToolDefinitions?.(agent.tools) ?? [])
        : (deps.toolRegistry?.toToolDefinitions?.() ?? [])
    const system = [
      agent.systemPrompt ?? '',
      agent.constraints?.length ? `\nConstraints:\n${agent.constraints.map((c: string) => `- ${c}`).join('\n')}` : '',
    ].join('\n')

    let fullText = ''
    let tokensUsed = 0
    for await (const event of deps.agentRunner.run({
      messages,
      tools,
      system,
      maxTurns: agent.maxTurns ?? 20,
      model: agent.model,
      toolContext: { conversationId, userId: 'channel', agentId, logger: deps.logger, teamSessionId, sessionId: teamSessionId, ...toolWorkspaceFields(conv?.workingDirectories) },
      autonomous: mode === 'autonomous',
      metadata: {
        conversationId,
        userId: 'channel',
        agentId: agentId ?? undefined,
        origin: 'channel' as const,
        autonomous: mode === 'autonomous',
        teamSessionId,
        // NOTE: metadata.teamSessionId presence forces autonomous classification
        // downstream (permission-bridge isAutonomousRequest) regardless of the
        // `autonomous` flag above — fail-closed, mirrors the chat route's
        // documented intent (conversations/routes.ts) that a team-run
        // conversation is never treated as a plain interactive turn.
      },
      signal,
    })) {
      if (event.type === 'text') fullText += event.text ?? ''
      else if (event.type === 'turn_complete') tokensUsed += event.tokensUsed ?? 0
    }

    if (fullText) deps.conversations.addMessage(conversationId, { role: 'assistant', content: fullText })
    if (tokensUsed) {
      if (deps.budgetEngine) deps.budgetEngine.trackUsage(agentId as string, tokensUsed)
      else deps.agentRegistry.addTokenUsage?.(agentId, tokensUsed)
    }

    return { replyText: fullText || null }
  }
}
