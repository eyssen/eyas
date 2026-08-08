// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/cache-prefix-builder.ts
import type { AgentWorkspace } from './workspace-types.js'
import type { CascadeResult } from './project-context-loader.js'
import type { SectionBudget } from './token-budget.js'
import { clipToBudget } from './token-budget.js'

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

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

export function buildCachePrefix(input: CachePrefixInput): string {
  const parts: string[] = []

  parts.push(tag('core-identity', clipToBudget(input.coreIdentity, input.budget.coreIdentity).content))
  parts.push(tag('core-rules', clipToBudget(input.coreRules, input.budget.coreRules).content))
  parts.push(tag('default-personality', clipToBudget(input.personality, input.budget.personality).content))

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
    const cascadeRaw = cascadeParts.join('\n')
    parts.push(tag('project-context', clipToBudget(cascadeRaw, input.budget.projectCascade).content))
  }

  parts.push(tag('agent-identity', clipToBudget(input.workspace.identity.body, input.budget.identityMd).content))
  parts.push(tag('agent-voice', clipToBudget(input.workspace.soulMd.body, input.budget.soulMd).content))

  if (input.workspace.agentsMd.body.trim()) {
    parts.push(tag('agent-notes', clipToBudget(input.workspace.agentsMd.body, input.budget.agentsMd).content))
  }
  if (input.workspace.toolsMd.body.trim()) {
    parts.push(tag('agent-env-notes', clipToBudget(input.workspace.toolsMd.body, input.budget.toolsMd).content))
  }

  if (input.skillsList.length > 0) {
    const skillsLines = ['The following skills are available to invoke:']
    for (const s of input.skillsList) skillsLines.push(`- ${s.name}: ${s.oneLine}`)
    skillsLines.push('Full skill content is loaded on-demand via `skill_load(name)`.')
    parts.push(tag('available-skills', clipToBudget(skillsLines.join('\n'), input.budget.skillsList).content))
  }

  if (input.toolsList.length > 0) {
    const toolsLines = ['The following tools are available:']
    for (const t of input.toolsList) toolsLines.push(`- ${t.name}: ${t.oneLine}`)
    toolsLines.push('Full tool schemas are delivered via the provider native tool API.')
    parts.push(tag('available-tools', clipToBudget(toolsLines.join('\n'), input.budget.toolsList).content))
  }

  return parts.join('').trimEnd() + '\n'
}
