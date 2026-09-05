// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { createWorkspaceWriter } from '../../src/modules/prompt-wizard/workspace-writer.js'
import { createSoulPipeline } from '../../src/modules/prompt-wizard/soul-pipeline.js'
import { defaultStyleForAgent, type PresetKey } from '../../src/modules/prompt-wizard/soul-presets.js'
import type { SplitResult } from './legacy-prompt-splitter.js'

export type AgentTier = 'primary' | 'team' | 'specialist'

export interface BootstrapAgentInput {
  dataDir: string
  agentId: string
  agentName: string
  tier: AgentTier
  split: SplitResult
  internalPreset?: PresetKey
  externalPreset?: PresetKey
}

function renderIdentityMd(name: string, split: SplitResult): string {
  return `# IDENTITY

## Who I am
- **Name:** ${name}

## My mission
${split.identityMission}

## Ongoing proactive duties
${split.identityProactiveDuties}

## When to escalate
${split.identityEscalation}

## When to refuse / defer
(define when needed)
`
}

/**
 * Materialize a single agent's v2 workspace from a legacy split result.
 *
 * Always writes IDENTITY.md, AGENTS.md (possibly empty), TOOLS.md, MEMORY.md.
 * Primary and team-tier agents additionally get SOUL.md + SOUL.style.json
 * via the SOUL pipeline; specialists do not (they speak through their
 * delegating parent's voice, not their own).
 */
export async function bootstrapAgentWorkspace(input: BootstrapAgentInput): Promise<void> {
  const writer = createWorkspaceWriter({ dataDir: input.dataDir })
  const soulPipeline = createSoulPipeline({ writer })

  await writer.write({ agentId: input.agentId, file: 'IDENTITY.md', body: renderIdentityMd(input.agentName, input.split) })

  if (input.tier === 'primary' || input.tier === 'team') {
    const style = defaultStyleForAgent(input.internalPreset ?? 'best-buddy', input.externalPreset ?? 'diplomata')
    await soulPipeline.saveStyle(input.agentId, input.agentName, style)
  }

  await writer.write({ agentId: input.agentId, file: 'AGENTS.md', body: input.split.agentsRules ?? '' })
  await writer.write({ agentId: input.agentId, file: 'TOOLS.md', body: '' })
  await writer.write({ agentId: input.agentId, file: 'MEMORY.md', body: '' })
}
