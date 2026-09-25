// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import { RECOMMENDED_TEMPLATES, SPECIALIST_TEMPLATES } from './agent-templates.js'
import { bootstrapAgentWorkspaceFromSeed } from './workspace-bootstrap.js'

export interface TeamTemplateInfo {
  id: string
  name: string
  description: string
  tier: string
  agentType: string
  defaultEnabled: boolean
  recommended: boolean
}

/** Optional specialist agents offerable as a team (recommended first). */
export function listTeamTemplates(): TeamTemplateInfo[] {
  return [
    ...RECOMMENDED_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, tier: t.tier, agentType: t.agentType, defaultEnabled: t.defaultEnabled, recommended: true })),
    ...SPECIALIST_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, tier: t.tier, agentType: t.agentType, defaultEnabled: t.defaultEnabled, recommended: false })),
  ]
}

/**
 * Create the selected optional specialist agents from their templates and
 * materialize their workspaces. Shared by the first-run setup wizard step
 * ('team-agents' onComplete) and the authenticated post-setup endpoint
 * (POST /api/v1/agents/team-bootstrap). With no selection, the recommended
 * defaults are created. Returns the agents actually created.
 */
export async function applyTeamAgentSelection(
  deps: { db: any; dataDir: string; newId?: () => string },
  selectedIds: string[],
): Promise<{ created: Array<{ id: string; name: string }> }> {
  const newId = deps.newId ?? generateId
  const allOptional = [...RECOMMENDED_TEMPLATES, ...SPECIALIST_TEMPLATES]
  const now = new Date().toISOString()

  const toCreate = selectedIds.length > 0
    ? allOptional.filter((t) => selectedIds.includes(t.id))
    : RECOMMENDED_TEMPLATES // defaults

  const created: Array<{ id: string; name: string }> = []
  for (const template of toCreate) {
    if (!template.workspaceSeed) {
      throw new Error(`Template ${template.id} is missing workspaceSeed — v2 setup requires it`)
    }
    const agentDefId = newId()
    const workspacePath = `data/agents/${agentDefId}`
    // team-tier optional agents are addressable; specialists are not
    const addressable = template.tier === 'team' ? 1 : 0

    deps.db.run(sql`INSERT OR IGNORE INTO agent_definitions
      (id, name, description, tier, agent_type, model, max_turns, enabled, source, addressable, workspace_path, tools, created_at, updated_at)
      VALUES (
        ${agentDefId}, ${template.name}, ${template.description},
        ${template.tier}, ${template.agentType},
        ${template.model}, ${template.maxTurns},
        ${1}, ${'seed'}, ${addressable},
        ${workspacePath}, ${JSON.stringify(template.tools)}, ${now}, ${now}
      )`)

    await bootstrapAgentWorkspaceFromSeed({
      dataDir: deps.dataDir,
      agentId: agentDefId,
      agentName: template.name,
      tier: template.tier,
      seed: template.workspaceSeed,
    })
    created.push({ id: agentDefId, name: template.name })
  }
  return { created }
}
