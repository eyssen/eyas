// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createWorkspaceWriter } from '@modules/prompt-wizard/workspace-writer'
import { createSoulPipeline } from '@modules/prompt-wizard/soul-pipeline'
import { defaultStyleForAgent } from '@modules/prompt-wizard/soul-presets'
import type { WorkspaceSeed } from './agent-templates.js'
import type { AgentTier } from './types.js'

const NAME_PLACEHOLDER = '(set during wizard)'

export interface BootstrapAgentWorkspaceFromSeedInput {
  dataDir: string
  agentId: string
  agentName: string
  tier: AgentTier
  seed: WorkspaceSeed
}

/**
 * Materialize a v2 agent workspace from a template `WorkspaceSeed`.
 *
 * Always writes IDENTITY.md (with `(set during wizard)` substituted to the
 * concrete agentName), AGENTS.md, TOOLS.md, MEMORY.md. Primary and team-tier
 * agents additionally get SOUL.md + SOUL.style.json via the SOUL pipeline,
 * derived from the seed's `soulStylePreset`. Specialists do not — they speak
 * through their parent's voice, not their own.
 *
 * Mirrors `scripts/lib/agent-workspace-bootstrap.ts` (which converts legacy
 * SplitResult), but accepts a `WorkspaceSeed` directly. Used by the setup
 * wizard's primary-agents and team-agents steps.
 */
export async function bootstrapAgentWorkspaceFromSeed(
  input: BootstrapAgentWorkspaceFromSeedInput,
): Promise<void> {
  const { dataDir, agentId, agentName, tier, seed } = input
  const writer = createWorkspaceWriter({ dataDir })

  const identity = seed.identityMd.split(NAME_PLACEHOLDER).join(agentName)
  await writer.write({ agentId, file: 'IDENTITY.md', body: identity })

  if ((tier === 'primary' || tier === 'team') && seed.soulStylePreset) {
    const soulPipeline = createSoulPipeline({ writer })
    const style = defaultStyleForAgent(seed.soulStylePreset.internal, seed.soulStylePreset.external)
    await soulPipeline.saveStyle(agentId, agentName, style)
  }

  await writer.write({ agentId, file: 'AGENTS.md', body: seed.agentsMdSeed })
  await writer.write({ agentId, file: 'TOOLS.md', body: seed.toolsMdSeed })
  await writer.write({ agentId, file: 'MEMORY.md', body: '' })
}
