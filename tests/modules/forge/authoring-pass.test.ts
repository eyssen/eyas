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

// No real betterApproach was ever recorded (topSuggestions empty) — this is
// the common case in production, since nothing in the pipeline writes it.
const pattern: FrictionPattern = {
  target: 'tool', targetId: 'tool-search',
  frictionCount: 6, totalUsages: 10, frictionRate: 0.6,
  topFrictions: ['Too slow', 'Wrong format'],
  topSuggestions: [],
  sampleFeedbackIds: ['fb-1', 'fb-2'],
}

describe('Forge — ProposalEngine authoring pass', () => {
  it('authors proposedValue via the model from the current description + raw friction samples', async () => {
    const store = mockProposalStore(false)
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const authored = 'Search files by name or content; results are cached to avoid repeated slow scans.'
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: authored }] })) as any
    const engine = createProposalEngine(store as any, { toolRegistry, model: { complete } as any })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe(authored)
    // betterApproach was never recorded — the authored text fills that gap.
    expect(addArg.reasoning).toContain(authored)

    expect(complete).toHaveBeenCalledOnce()
    const request = complete.mock.calls[0][0]
    const userMessage = request.messages.find((m: any) => m.role === 'user').content
    expect(userMessage).toContain('Search files')
    expect(userMessage).toContain('Too slow')
    expect(userMessage).toContain('Wrong format')
  })

  it('falls back to the current string-concat proposedValue when the model is absent, without throwing', async () => {
    const store = mockProposalStore(false)
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const engine = createProposalEngine(store as any, { toolRegistry })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe('Search files. Common issue: Too slow — consider alternatives when this occurs.')
    // No model output to reuse — reasoning keeps its pre-authoring (blank suggestion) shape.
    expect(addArg.reasoning.trim().endsWith('.')).toBe(true)
  })

  it('falls back without throwing when model.complete errors', async () => {
    const store = mockProposalStore(false)
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const complete = vi.fn(async () => { throw new Error('model down') })
    const engine = createProposalEngine(store as any, { toolRegistry, model: { complete } as any })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe('Search files. Common issue: Too slow — consider alternatives when this occurs.')
  })

  it('prefers a real recorded betterApproach over the authored text when both exist', async () => {
    const store = mockProposalStore(false)
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Authored replacement.' }] }))
    const engine = createProposalEngine(store as any, { toolRegistry, model: { complete } as any })
    const patternWithSuggestion: FrictionPattern = { ...pattern, topSuggestions: ['Use cached results'] }

    await engine.generateFromFriction(patternWithSuggestion)

    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe('Authored replacement.') // still model-authored
    expect(addArg.reasoning).toContain('Suggested: Use cached results') // real suggestion wins over reuse
  })
})
