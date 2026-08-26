// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise assemble via the prompt assembler (with a fallback agentId) and
// compose the AssembledPrompt into a single string. Fails soft — never
// throws — so a missing agent/assembler degrades gracefully, but the failure is now
// RECORDED (assemblerError) instead of vanishing into a bare catch.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { estimateTokens } from '@modules/prompt-wizard/token-budget'

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

function rawSection(key: string, content: string): ContextSection {
  return {
    zone: 'append',
    key,
    content,
    chars: content.length,
    estimatedTokens: estimateTokens(content),
    truncated: false,
    droppedChars: 0,
  }
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<ResolvedSystemPrompt> {
  if (args.bodySystem) {
    return {
      system: args.bodySystem,
      sections: [rawSection('body-system-override', args.bodySystem)],
      entryPoint: 'unassembled',
    }
  }
  if (!args.assembler) {
    return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no assembler available' }
  }
  try {
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) {
      return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no agent resolved' }
    }
    const assembled = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName today; id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: null,
    })
    const system = [assembled.prefix, assembled.suffix, ...assembled.reminders]
      .filter((s) => s.trim())
      .join('\n\n')
    return { system, sections: assembled.sections, entryPoint: 'conversation' }
  } catch (err) {
    return {
      system: '',
      sections: [],
      entryPoint: 'unassembled',
      assemblerError: err instanceof Error ? err.message : String(err),
    }
  }
}
