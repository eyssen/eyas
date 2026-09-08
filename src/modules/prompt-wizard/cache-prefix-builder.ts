// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/cache-prefix-builder.ts
import type { AgentWorkspace } from './workspace-types.js'
import type { CascadeResult } from './project-context-loader.js'
import type { SectionBudget } from './token-budget.js'
import type { ContextSection } from './types.js'
import { createSectionCollector } from './section-collector.js'
import { renderInventory } from './inventory.js'

export interface CachePrefixInput {
  coreIdentity: string
  coreRules: string
  personality: string
  workspace: AgentWorkspace
  cascade: CascadeResult
  skillsList: { name: string; oneLine: string }[]
  toolsList: { name: string; oneLine: string }[]
  budget: SectionBudget
}

export function buildCachePrefix(input: CachePrefixInput): { content: string; sections: ContextSection[] } {
  const c = createSectionCollector('prefix')
  const parts: string[] = []

  parts.push(c.push('core-identity', input.coreIdentity, input.budget.coreIdentity))
  parts.push(c.push('core-rules', input.coreRules, input.budget.coreRules))
  parts.push(c.push('default-personality', input.personality, input.budget.personality))

  if (input.cascade.projectTypeAgents || input.cascade.projectAgents) {
    const cascadeParts: string[] = []
    if (input.cascade.projectTypeAgents) {
      cascadeParts.push(`<source name="project-type" id="${input.cascade.projectTypeId ?? ''}">`)
      cascadeParts.push(input.cascade.projectTypeAgents.trim())
      cascadeParts.push('</source>')
    }
    if (input.cascade.projectAgents) {
      cascadeParts.push(`<source name="project" id="${input.cascade.projectId ?? ''}">`)
      cascadeParts.push(input.cascade.projectAgents.trim())
      cascadeParts.push('</source>')
    }
    parts.push(
      c.push('project-context', cascadeParts.join('\n'), input.budget.projectCascade, input.cascade.projectId ?? undefined),
    )
  }

  // Immediately after project-context: the prefix is already project-scoped,

  parts.push(c.push('agent-identity', input.workspace.identity.body, input.budget.identityMd))
  parts.push(c.push('agent-voice', input.workspace.soulMd.body, input.budget.soulMd))
  parts.push(c.push('agent-notes', input.workspace.agentsMd.body, input.budget.agentsMd))
  parts.push(c.push('agent-env-notes', input.workspace.toolsMd.body, input.budget.toolsMd))

  // Both inventories go through renderInventory rather than being joined and
  // hard-clipped. Measured before this: 56 tools became 13 586 characters
  // against a 2 000-character budget, so the model saw eight of them, and the
  // clip took the closing line about where schemas come from with it. Dropping
  // the descriptions keeps every NAME, which is the part the rest of the prompt
  // refers to.
  if (input.skillsList.length > 0) {
    const skills = renderInventory({
      heading: 'The following skills are available to invoke:',
      items: input.skillsList,
      footer: 'Full skill content is loaded on-demand via `skill_load(name)`.',
      budgetTokens: input.budget.skillsList,
    })
    parts.push(c.push('available-skills', skills.content, input.budget.skillsList))
  }

  if (input.toolsList.length > 0) {
    const tools = renderInventory({
      heading: 'The following tools are available:',
      items: input.toolsList,
      footer: 'Full tool schemas are delivered via the provider native tool API.',
      budgetTokens: input.budget.toolsList,
    })
    parts.push(c.push('available-tools', tools.content, input.budget.toolsList))
  }

  return { content: parts.join('').trimEnd() + '\n', sections: c.sections }
}
