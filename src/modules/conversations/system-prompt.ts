// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise delegate to the shared fail-soft assembler helper. Kept as a thin
// named wrapper because the interactive path reports its own entryPoint label
// ('conversation') and the context inspector keys off it.
//
// The per-message turn block (clock + recalled memory) is built either way: a
// body.system override replaces the system prompt only, never what EYAS
// recalled for the message.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'
import type { ContextSection, PromptDelivery } from '@modules/prompt-wizard/types'
import type { DeliveryTarget } from '@modules/prompt-wizard/delivery-profile'
import { assembleSystemPrompt, rawSection } from '@modules/prompt-wizard/assemble-system'

interface ResolveArgs {
  bodySystem?: string
  assembler?: PromptAssembler
  agentId: string | null
  projectId: string | null
  conversationId: string
  fallbackAgentId?: () => string | null
  /** The provider/model this turn runs on; sizes the prompt for it. */
  target?: DeliveryTarget
  /** The current message, for recall's query. Empty: the last stored user message. */
  turnText?: string | null
}

export interface ResolvedSystemPrompt {
  system: string
  sections: ContextSection[]
  entryPoint: 'conversation' | 'unassembled'
  assemblerError?: string
  /** Who the prompt was sized for (assembled only). */
  delivery?: PromptDelivery
  /** The per-message turn block; the caller attaches it to the message it sends. */
  turn?: string
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<ResolvedSystemPrompt> {
  const r = await assembleSystemPrompt({
    assembler: args.assembler,
    agentId: args.agentId,
    conversationId: args.conversationId,
    projectId: args.projectId,
    fallbackAgentId: args.fallbackAgentId,
    target: args.target,
    turnText: args.turnText ?? null,
  })
  const turnParts = {
    ...(r.delivery ? { delivery: r.delivery } : {}),
    ...(r.turn ? { turn: r.turn } : {}),
  }
  if (args.bodySystem) {
    // The override replaces the system prompt; the turn block's sections stay
    // on the record because the turn still reaches the model.
    return {
      system: args.bodySystem,
      sections: [rawSection('body-system-override', args.bodySystem), ...r.sections.filter((s) => s.zone === 'turn')],
      entryPoint: 'unassembled',
      ...turnParts,
    }
  }
  return {
    system: r.system,
    sections: r.sections,
    entryPoint: r.entryPoint === 'assembled' ? 'conversation' : 'unassembled',
    assemblerError: r.assemblerError,
    ...turnParts,
  }
}
