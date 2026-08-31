// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/assemble-system.ts
//
// THE assemble-and-flatten helper. Every system-prompt entry point in EYAS
// goes through this function, so that whatever the assembler learns to inject
// (a project brand, a design reference) reaches all of them at once instead of
// only the four that happened to call buildForPrimary directly.
//
// It never throws. A missing assembler, a missing agent and a failing
// assembler all return an empty system with `entryPoint: 'unassembled'` and a
// populated `assemblerError`, so the caller can record the failure rather than
// have it vanish into a bare catch.

import type { AssembledPrompt, ContextSection } from './types.js'
import { estimateTokens } from './token-budget.js'

export interface AssemblerLike {
  buildForPrimary(opts: {
    agentId: string
    agentName: string
    conversationId: string | null
    projectId: string | null
    channelContext: unknown
  }): Promise<AssembledPrompt>
}

export interface AssembleSystemArgs {
  assembler?: AssemblerLike
  agentId: string | null
  conversationId: string | null
  projectId: string | null
  channelContext?: unknown
  /** Used when agentId is null — e.g. the conversation has no bound agent. */
  fallbackAgentId?: () => string | null
}

export interface AssembledSystem {
  system: string
  sections: ContextSection[]
  entryPoint: 'assembled' | 'unassembled'
  assemblerError?: string
}

/** Build a ContextSection for text that did not come from the assembler. */
export function rawSection(key: string, content: string): ContextSection {
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

/** Compose an AssembledPrompt into the single string providers take. */
export function flattenAssembled(a: AssembledPrompt): string {
  return [a.prefix, a.suffix, ...a.reminders].filter((s) => s.trim()).join('\n\n')
}

export async function assembleSystemPrompt(args: AssembleSystemArgs): Promise<AssembledSystem> {
  if (!args.assembler) {
    return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no assembler available' }
  }
  try {
    // Resolving the agent id happens INSIDE the try on purpose: fallbackAgentId
    // is a caller-supplied lookup that can hit the database, and a throw from
    // it must degrade like any other assembly failure rather than escape.
    const agentId = args.agentId ?? args.fallbackAgentId?.() ?? null
    if (!agentId) {
      return { system: '', sections: [], entryPoint: 'unassembled', assemblerError: 'no agent resolved' }
    }
    const built = await args.assembler.buildForPrimary({
      agentId,
      agentName: agentId, // buildForPrimary does not read agentName; the id is a safe label
      conversationId: args.conversationId,
      projectId: args.projectId,
      channelContext: args.channelContext ?? null,
    })
    return { system: flattenAssembled(built), sections: built.sections, entryPoint: 'assembled' }
  } catch (err) {
    return {
      system: '',
      sections: [],
      entryPoint: 'unassembled',
      assemblerError: err instanceof Error ? err.message : String(err),
    }
  }
}
