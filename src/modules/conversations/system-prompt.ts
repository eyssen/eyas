// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise delegate to the shared fail-soft assembler helper. Kept as a thin
// named wrapper because the interactive path reports its own entryPoint label
// ('conversation') and the context inspector keys off it.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { assembleSystemPrompt, rawSection } from '@modules/prompt-wizard/assemble-system'

interface ResolveArgs {
  bodySystem?: string
  assembler?: PromptAssembler
  agentId: string | null
  projectId: string | null
  conversationId: string
  fallbackAgentId?: () => string | null
}

export interface ResolvedSystemPrompt {
  system: string
  sections: ContextSection[]
  entryPoint: 'conversation' | 'unassembled'
  assemblerError?: string
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<ResolvedSystemPrompt> {
  if (args.bodySystem) {
    return {
      system: args.bodySystem,
      sections: [rawSection('body-system-override', args.bodySystem)],
      entryPoint: 'unassembled',
    }
  }
  const r = await assembleSystemPrompt({
    assembler: args.assembler,
    agentId: args.agentId,
    conversationId: args.conversationId,
    projectId: args.projectId,
    fallbackAgentId: args.fallbackAgentId,
  })
  return {
    system: r.system,
    sections: r.sections,
    entryPoint: r.entryPoint === 'assembled' ? 'conversation' : 'unassembled',
    assemblerError: r.assemblerError,
  }
}
