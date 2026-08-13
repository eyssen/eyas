// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/system-prompt.ts
// Resolves the interactive-chat system prompt: body.system override wins;
// otherwise assemble via the prompt assembler (with a fallback agentId) and
// compose the AssembledPrompt into a single string. Fails soft to '' — never
// throws — so a missing agent/assembler degrades gracefully.
import type { PromptAssembler } from '@modules/prompt-wizard/assembler'

interface ResolveArgs {
  bodySystem?: string
  assembler?: PromptAssembler
  agentId: string | null
  projectId: string | null
  conversationId: string
  fallbackAgentId?: () => string | null
}

export async function resolveConversationSystemPrompt(args: ResolveArgs): Promise<string> {
  if (args.bodySystem) return args.bodySystem
  if (!args.assembler) return ''
  try {
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) return ''
    const assembled = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName today; id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: null,
    })
    return [assembled.prefix, assembled.suffix, ...assembled.reminders].filter((s) => s.trim()).join('\n\n')
  } catch {
    return ''
  }
}
