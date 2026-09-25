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
//
// Recalled memory follows the reply's audience: a conversation whose voice
// scope resolves to 'external' (someone other than the owner and the team
// reads the answer) gets no pushed owner memory — the turn block carries the
// time only. The scope comes from the same override chain the reply's voice
// uses (communication/active-voice-resolver.ts).

import { toolWorkspaceFields } from '@modules/tools/working-directories.js'
import { buildDelegatedSystemPrompt } from '@modules/agent/delegated-system-prompt.js'
import { resolveToolScope, scopedToolDefinitions } from '@modules/agent/tool-scope.js'
import { deliveryRecordFields, type AssemblerLike } from '@modules/prompt-wizard/assemble-system.js'
import { estimateMessagesTokens } from '@modules/prompt-wizard/token-budget.js'
import { observeRunEvents, type ContextRecorder } from '@modules/observability/context-recorder.js'
import type { VoiceScope } from '@modules/prompt-wizard/types.js'
import { buildTurnMeta, createUsageTally, turnEffortOf } from '@modules/conversations/turn-meta.js'
import { loadEffortIntent, type EffortIntentDb } from '@modules/conversations/effort-intent.js'
import type { TurnBinding, TurnEffort, TurnOutcome } from '@shared/chat-stream.js'
import { resolveRunBinding, runConversationRow, turnBindingOf, type BindingResolver } from '@modules/model/binding.js'
import { captureRunEnd, type MemoryCaptureFn } from '@modules/memory/capture/run-end.js'

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
  /**
   * F0 — routes channel replies through the prompt assembler so a channel
   * answer carries the same project/workspace context an interactive answer
   * does. Absent (or throwing) falls back to the agent's own systemPrompt,
   * which is exactly the pre-F0 behaviour.
   */
  promptAssembler?: AssemblerLike
  /**
   * Optional — records what the channel reply's prompt was actually made of,
   * and what the provider measured on the reply's last model call.
   */
  contextRecorder?: Pick<ContextRecorder, 'record' | 'observe'>
  /**
   * The conversation's resolved voice scope (communication wires the voice
   * resolver's scope half). 'external' withholds recalled owner memory. A
   * resolver that throws counts as 'external' — no recall is the safe miss.
   * Absent: 'internal' (the owner-DM default every prompt is resolved with).
   */
  resolveVoiceScope?: (input: { agentId: string; conversationId: string }) => Promise<VoiceScope> | VoiceScope
  /**
   * The model binding resolver (ctx.modelBinding; pass a getter). The reply
   * runs on the channel conversation's binding: the bound agent's
   * provider+model, else the pair fixed on the conversation, else the
   * install default — fixed on the conversation on its first reply, so a
   * later default change does not move it (H4).
   */
  modelBinding?: Pick<BindingResolver, 'resolve'>
  /**
   * The database, for the reply's effort intent (effort-intent.ts). Absent:
   * the conversation's own settings and the bound agent's effort still
   * apply; only the parent walk is skipped.
   */
  db?: EffortIntentDb
  /**
   * The durable-fact pass (ctx.memoryCapture; pass a getter — the memory
   * module publishes it, in whatever order modules start). The inbound
   * message is a peer's words, so the capture reads it as such: never a note
   * about the owner or a rule for how to work, and peer trust on what it
   * writes. Absent: the reply captures nothing and never fails for it.
   */
  memoryCapture?: MemoryCaptureFn
}

export interface ChannelRunInput {
  conversationId: string
  agentId: string | null
  mode: string
  signal?: AbortSignal
}

/** The last inbound (role 'user') message of the conversation, as stored. */
function lastUserMessage(messages: Array<{ role?: string; content?: string | null }> | undefined): string {
  const list = messages ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') return list[i].content ?? ''
  }
  return ''
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
    // The reply's model: one binding of the channel conversation (H4). A
    // binding nothing can serve means no reply (logged), never a guessed
    // provider.
    let provider: string | undefined
    let model: string | undefined
    let turnBinding: TurnBinding | undefined
    try {
      const run = await resolveRunBinding({
        resolver: deps.modelBinding,
        conversation: runConversationRow(conv ? { ...conv, id: conv.id ?? conversationId } : null, agentId, conversationId),
        agent,
        materialize: (id, pair) => deps.conversations?.materializeBinding?.(id, pair.providerId, pair.modelId) ?? null,
      })
      provider = run.providerId
      model = run.modelId
      turnBinding = run.resolved ? turnBindingOf(run.resolved) : undefined
    } catch (err) {
      deps.logger?.warn?.({ err, conversationId, agentId }, 'Channel run skipped: no model can serve this conversation')
      return { replyText: null }
    }
    const messages = (conv?.messages ?? []).map((m: any) => ({ role: m.role, content: m.content }))
    // The same tool scope every EYAS run path applies (agent/tool-scope.ts).
    const tools = scopedToolDefinitions(
      deps.toolRegistry,
      resolveToolScope({ agentTools: agent.tools, orchestration: conv?.orchestration }),
      { agentId, logger: deps.logger },
    )
    const constraints = agent.constraints?.length
      ? `\nConstraints:\n${agent.constraints.map((c: string) => `- ${c}`).join('\n')}`
      : ''
    let voiceScope: VoiceScope = 'internal'
    if (deps.resolveVoiceScope) {
      try {
        voiceScope = await deps.resolveVoiceScope({ agentId: agentId as string, conversationId })
      } catch (err) {
        voiceScope = 'external'
        deps.logger?.warn?.({ err, conversationId, agentId }, 'Channel run: voice scope unresolved; replying without recalled memory')
      }
    }
    const composed = await buildDelegatedSystemPrompt({
      assembler: deps.promptAssembler,
      agentId,
      conversationId,
      projectId: conv?.projectId ?? null,
      agentSystemPrompt: [agent.systemPrompt ?? '', constraints].join('\n'),
      // I7: sized and tool-addressed for the model this run calls.
      target: { providerId: provider ?? null, modelId: model ?? null },
      // Recall's query comes from the stored inbound message; an external
      // reader gets none.
      audience: voiceScope === 'external' ? 'external' : 'owner',
    })
    const system = composed.system
    const compositionId = deps.contextRecorder?.record({
      sections: composed.sections,
      entryPoint: composed.entryPoint === 'assembled' ? 'channel' : 'unassembled',
      assemblerError: composed.assemblerError,
      conversationId,
      agentId,
      provider,
      model,
      ...deliveryRecordFields(composed.delivery),
      historyEstimatedTokens: estimateMessagesTokens(messages),
    }) ?? null

    // The reply's effort (effort-intent.ts): the conversation's own level,
    // else Max when Deep, else the bound agent's effort, else a parent's.
    const effort = loadEffortIntent(
      { db: deps.db, getAgent: (id) => deps.agentRegistry?.get(id) },
      conversationId,
      {
        agentId,
        ...(conv ? {
          self: {
            effort: conv.effort,
            orchestration: conv.orchestration,
            parentConversationId: conv.parentConversationId ?? null,
          },
        } : {}),
      },
    )

    let fullText = ''
    let tokensUsed = 0
    // Each model call's usage, for the reply's TurnMeta.
    const tally = createUsageTally()
    // How the run ended (the runner's single terminal): a turn-cap or budget
    // stop still sends the partial reply, but is not silent.
    let outcome: TurnOutcome | undefined
    let stopReason: string | undefined
    // The final call's requested vs effective effort, recorded with the reply.
    let turnEffort: TurnEffort | undefined
    // What the provider measures on the reply's last model call goes to its
    // composition (context occupancy), however the run ends.
    for await (const event of observeRunEvents<any>(deps.agentRunner.run({
      messages,
      tools,
      system,
      delivery: composed.delivery?.profile,
      // The clock and (for an owner-voice reply) the recall, attached to the
      // inbound message the runner sends.
      turn: composed.turn,
      maxTurns: agent.maxTurns ?? 20,
      provider,
      model,
      effort,
      toolContext: { conversationId, projectId: conv?.projectId ?? null, userId: 'channel', agentId, logger: deps.logger, teamSessionId, sessionId: teamSessionId, ...toolWorkspaceFields(conv?.workingDirectories) },
      autonomous: mode === 'autonomous',
      metadata: {
        conversationId,
        compositionId: compositionId ?? undefined,
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
    }), deps.contextRecorder, compositionId)) {
      if (event.type === 'text') fullText += event.text ?? ''
      else if (event.type === 'turn_complete') {
        tokensUsed += event.tokensUsed ?? 0
        tally.add(event.usage)
      } else if (event.type === 'done') {
        outcome = event.outcome
        stopReason = event.stopReason
        turnEffort = turnEffortOf(event.response?.effortOutcome)
      } else if (event.type === 'cancelled') outcome = 'cancelled'
      else if (event.type === 'parked_for_approval') outcome = 'parked'
    }
    if (outcome && outcome !== 'completed') {
      deps.logger?.info?.({ conversationId, agentId, outcome }, 'Channel run ended early; sending the partial reply')
    }

    if (fullText) {
      const turnMeta = buildTurnMeta({
        outcome: outcome ?? 'completed',
        stopReason,
        summary: tally.summarize(provider, model),
        ...(turnBinding ? { binding: turnBinding } : {}),
        ...(turnEffort ? { effort: turnEffort } : {}),
      })
      // Recorded with the pair that answered (H4).
      deps.conversations.addMessage(conversationId, {
        role: 'assistant', content: fullText,
        ...(provider ? { provider } : {}), ...(model ? { model } : {}),
        entryPath: 'channel', turnMeta,
      })
    }

    // The durable-fact pass (F1) on the inbound message and the reply,
    // through the entry every run path shares (memory/capture/run-end.ts):
    // the same gate, cap and run row as an interactive turn. The inbound
    // message is stored as a peer's (inbound-coordinator), and read as one.
    captureRunEnd(deps.memoryCapture, {
      conversationId,
      projectId: conv?.projectId ?? null,
      userMessage: lastUserMessage(conv?.messages),
      assistantMessage: fullText,
      author: 'peer',
      entryPath: 'channel',
    })
    if (tokensUsed) {
      if (deps.budgetEngine) deps.budgetEngine.trackUsage(agentId as string, tokensUsed)
      else deps.agentRegistry.addTokenUsage?.(agentId, tokensUsed)
    }

    return { replyText: fullText || null }
  }
}
