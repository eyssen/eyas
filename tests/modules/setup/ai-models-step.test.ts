// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildAgentProposals, type SeedAgentRow } from '@modules/model/ai-models-step.js'
import type { ProviderModels } from '@modules/model/tier-resolver.js'

const providers: ProviderModels[] = [
  { providerId: 'claude-code', modelIds: ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku'] },
]
const agents: SeedAgentRow[] = [
  { id: 'a1', name: 'Reviewer', agent_type: 'reviewer' },
  { id: 'a2', name: 'Helper', agent_type: 'assistant' },
  { id: 'a3', name: 'Monitor', agent_type: 'observer' },
]

describe('buildAgentProposals', () => {
  it('proposes tier-appropriate concrete models per agent', () => {
    const out = buildAgentProposals(agents, providers)
    expect(out).toEqual([
      { id: 'a1', name: 'Reviewer', agentType: 'reviewer', proposedTier: 'opus', proposedModelId: 'claude-code-opus' },
      { id: 'a2', name: 'Helper', agentType: 'assistant', proposedTier: 'sonnet', proposedModelId: 'claude-code-sonnet' },
      { id: 'a3', name: 'Monitor', agentType: 'observer', proposedTier: 'haiku', proposedModelId: 'claude-code-haiku' },
    ])
  })
  it('leaves proposedModelId null when no provider available', () => {
    const out = buildAgentProposals(agents, [])
    expect(out[0].proposedModelId).toBeNull()
  })
})
