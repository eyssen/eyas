// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createProposalApplier } from '@modules/forge/applier'
import type { ForgeProposal } from '@modules/forge/types'

function makeProposal(overrides: Partial<ForgeProposal> = {}): ForgeProposal {
  return {
    id: 'p-1',
    target: 'tool',
    targetId: 'tool-search',
    scope: 'description',
    title: 'Improve search tool description',
    description: 'Make it clearer',
    currentValue: 'Old desc',
    proposedValue: 'New desc',
    reasoning: 'Users confused',
    confidence: 0.85,
    basedOnFeedbacks: 5,
    status: 'approved',
    experimentId: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    ...overrides,
  }
}

describe('Forge — ProposalApplier', () => {
  it('applies tool description change via toolRegistry', () => {
    const updateDescription = vi.fn()
    const applier = createProposalApplier({
      toolRegistry: { get: () => ({ name: 'tool-search', description: 'Old' }), updateDescription },
    })

    const result = applier.apply(makeProposal())
    expect(result.success).toBe(true)
    expect(result.message).toContain('tool-search')
    expect(updateDescription).toHaveBeenCalledWith('tool-search', 'New desc')
  })

  it('applies skill description change via skillRegistry', () => {
    const update = vi.fn(() => true)
    const applier = createProposalApplier({
      skillRegistry: { get: () => ({ id: 'sk-1', description: 'Old' }), update },
    })

    const result = applier.apply(makeProposal({ target: 'skill', targetId: 'sk-1' }))
    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledWith('sk-1', { description: 'New desc' })
  })

  it('reports failure when the target skill does not exist', () => {
    const update = vi.fn(() => false)
    const applier = createProposalApplier({
      skillRegistry: { get: () => undefined, update },
    })

    const result = applier.apply(makeProposal({ target: 'skill', targetId: 'missing' }))
    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })

  it('returns failure for non-description scope', () => {
    const applier = createProposalApplier({})
    const result = applier.apply(makeProposal({ scope: 'schema' }))
    expect(result.success).toBe(false)
    expect(result.message).toContain('manual application')
  })

  it('returns failure when no registry available', () => {
    const applier = createProposalApplier({})
    const result = applier.apply(makeProposal())
    expect(result.success).toBe(false)
  })
})
