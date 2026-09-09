// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/agent/delegated-system-prompt.ts
//
// executeAgent's system prompt. Historically this path sent the agent
// definition's raw systemPrompt and nothing else, which meant delegated
// subagents never saw the project cascade, the workspace files, or anything
// else the assembler contributes.
//
// The composition is ADDITIVE on purpose: assembled prompt first, the agent
// definition's own prompt last. An agent whose persona lives only in the DB
// keeps working exactly as before, and a failing assembler degrades to the old
// behaviour instead of emptying the prompt.

import {
  assembleSystemPrompt,
  rawSection,
  type AssembleSystemArgs,
  type AssembledSystem,
} from '@modules/prompt-wizard/assemble-system.js'

export interface DelegatedPromptArgs extends AssembleSystemArgs {
  /** The agent definition's own system prompt, appended after the assembly. */
  agentSystemPrompt?: string | null
}

export async function buildDelegatedSystemPrompt(args: DelegatedPromptArgs): Promise<AssembledSystem> {
  const { agentSystemPrompt, ...assembleArgs } = args
  const assembled = await assembleSystemPrompt(assembleArgs)

  const own = (agentSystemPrompt ?? '').trim()
  if (!own) return assembled

  const ownSection = rawSection('agent-definition-prompt', own)
  return {
    system: [assembled.system, own].filter((s) => s.trim()).join('\n\n'),
    sections: [...assembled.sections, ownSection],
    entryPoint: assembled.entryPoint,
    assemblerError: assembled.assemblerError,
  }
}
