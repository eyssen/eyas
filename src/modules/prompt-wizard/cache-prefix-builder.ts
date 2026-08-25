// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/cache-prefix-builder.ts
import type { AgentWorkspace } from './workspace-types.js'
import type { CascadeResult } from './project-context-loader.js'
import type { SectionBudget } from './token-budget.js'
import type { ContextSection } from './types.js'
import { createSectionCollector } from './section-collector.js'

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

  parts.push(c.push('agent-identity', input.workspace.identity.body, input.budget.identityMd))
  parts.push(c.push('agent-voice', input.workspace.soulMd.body, input.budget.soulMd))
  parts.push(c.push('agent-notes', input.workspace.agentsMd.body, input.budget.agentsMd))
  parts.push(c.push('agent-env-notes', input.workspace.toolsMd.body, input.budget.toolsMd))

  if (input.skillsList.length > 0) {
    const skillsLines = ['The following skills are available to invoke:']
    for (const s of input.skillsList) skillsLines.push(`- ${s.name}: ${s.oneLine}`)
    skillsLines.push('Full skill content is loaded on-demand via `skill_load(name)`.')
    parts.push(c.push('available-skills', skillsLines.join('\n'), input.budget.skillsList))
  }

  if (input.toolsList.length > 0) {
    const toolsLines = ['The following tools are available:']
    for (const t of input.toolsList) toolsLines.push(`- ${t.name}: ${t.oneLine}`)
    toolsLines.push('Full tool schemas are delivered via the provider native tool API.')
    parts.push(c.push('available-tools', toolsLines.join('\n'), input.budget.toolsList))
  }

  return { content: parts.join('').trimEnd() + '\n', sections: c.sections }
}
