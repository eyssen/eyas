// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createProposalEngine } from '@modules/forge/proposal-engine'
import type { FrictionPattern, ForgeProposal, CreateProposalInput } from '@modules/forge/types'

function mockProposalStore(hasPendingResult = false) {
  return {
    hasPending: vi.fn().mockReturnValue(hasPendingResult),
    add: vi.fn((input: CreateProposalInput): ForgeProposal => ({
      id: 'prop-1', ...input,
      status: 'pending', experimentId: null,
      createdAt: new Date().toISOString(), reviewedAt: null,
    })),
    get: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
    setExperiment: vi.fn(),
  }
}

const pattern: FrictionPattern = {
  target: 'tool', targetId: 'tool-search',
  frictionCount: 6, totalUsages: 10, frictionRate: 0.6,
  topFrictions: ['Too slow', 'Wrong format'],
  topSuggestions: ['Use cached results'],
  sampleFeedbackIds: ['fb-1', 'fb-2'],
}

describe('Forge — ProposalEngine', () => {
  it('generates description-scope proposal from friction pattern', async () => {
    const store = mockProposalStore(false)
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const engine = createProposalEngine(store as any, { toolRegistry })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    expect(store.add).toHaveBeenCalledOnce()
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.scope).toBe('description')
    expect(addArg.target).toBe('tool')
    expect(addArg.targetId).toBe('tool-search')
    expect(addArg.currentValue).toBe('Search files')
    expect(addArg.proposedValue).toContain('Use cached results')
    expect(addArg.confidence).toBeCloseTo(0.3, 1)
    expect(toolRegistry.get).toHaveBeenCalledWith('tool-search')
  })

  it('skips if proposal already pending', async () => {
    const store = mockProposalStore(true)
    const engine = createProposalEngine(store as any, {})

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(0)
    expect(store.add).not.toHaveBeenCalled()
    expect(store.hasPending).toHaveBeenCalledWith('tool', 'tool-search', 'description')
  })
})
