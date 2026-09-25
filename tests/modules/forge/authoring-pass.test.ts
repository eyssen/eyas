// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createProposalEngine } from '@modules/forge/proposal-engine'
import type { FrictionPattern, ForgeProposal, CreateProposalInput } from '@modules/forge/types'
import {
  auxError,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

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
  const CONCAT = 'Search files. Common issue: Too slow — consider alternatives when this occurs.'
  const toolRegistry = () => ({ get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) })

  it('authors proposedValue via the background model from the current description + raw friction samples', async () => {
    const store = mockProposalStore(false)
    const authored = 'Search files by name or content; results are cached to avoid repeated slow scans.'
    const aux = createFakeAuxiliaryModel(auxOk(authored))
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry(), aux })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe(authored)
    // betterApproach was never recorded — the authored text fills that gap.
    expect(addArg.reasoning).toContain(authored)

    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0].purpose).toBe('forge')
    expect(aux.calls[0].user).toContain('Search files')
    expect(aux.calls[0].user).toContain('Too slow')
    expect(aux.calls[0].user).toContain('Wrong format')
  })

  it('reaches the gateway isolated, with the instruction in request.system and no system message', async () => {
    const store = mockProposalStore(false)
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ answer: 'Improved description.' })
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry(), aux })

    await engine.generateFromFriction(pattern)

    expect(store.add.mock.calls[0][0].proposedValue).toBe('Improved description.')
    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].system).toMatch(/improving the description/)
    expect(requests[0].messages.every((m) => m.role === 'user')).toBe(true)
    expect(requests[0].metadata).toMatchObject({ purpose: 'forge', origin: 'pipeline' })
  })

  it('falls back to the current string-concat proposedValue when no background model is wired, without throwing', async () => {
    const store = mockProposalStore(false)
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry() })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe(CONCAT)
    // No model output to reuse — reasoning keeps its pre-authoring (blank suggestion) shape.
    expect(addArg.reasoning.trim().endsWith('.')).toBe(true)
  })

  it('falls back to the string-concat with zero model calls when no model is eligible (Grok-only)', async () => {
    const store = mockProposalStore(false)
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ providers: ['grok-cli'], tiers: [] })
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry(), aux })

    await engine.generateFromFriction(pattern)

    expect(store.add.mock.calls[0][0].proposedValue).toBe(CONCAT)
    expect(requests).toHaveLength(0)
  })

  it('falls back without throwing when the call fails', async () => {
    const store = mockProposalStore(false)
    const aux = createFakeAuxiliaryModel(auxError('model down'))
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry(), aux })

    const proposals = await engine.generateFromFriction(pattern)

    expect(proposals).toHaveLength(1)
    expect(store.add.mock.calls[0][0].proposedValue).toBe(CONCAT)
  })

  it('reads the service at call time, so a getter wired before the model module still works', async () => {
    const store = mockProposalStore(false)
    let late: ReturnType<typeof createFakeAuxiliaryModel> | undefined
    const engine = createProposalEngine(store as any, {
      toolRegistry: toolRegistry(),
      get aux() {
        return late
      },
    })
    late = createFakeAuxiliaryModel(auxOk('Late-bound description.'))

    await engine.generateFromFriction(pattern)

    expect(store.add.mock.calls[0][0].proposedValue).toBe('Late-bound description.')
  })

  it('prefers a real recorded betterApproach over the authored text when both exist', async () => {
    const store = mockProposalStore(false)
    const aux = createFakeAuxiliaryModel(auxOk('Authored replacement.'))
    const engine = createProposalEngine(store as any, { toolRegistry: toolRegistry(), aux })
    const patternWithSuggestion: FrictionPattern = { ...pattern, topSuggestions: ['Use cached results'] }

    await engine.generateFromFriction(patternWithSuggestion)

    const addArg = store.add.mock.calls[0][0]
    expect(addArg.proposedValue).toBe('Authored replacement.') // still model-authored
    expect(addArg.reasoning).toContain('Suggested: Use cached results') // real suggestion wins over reuse
  })
})
