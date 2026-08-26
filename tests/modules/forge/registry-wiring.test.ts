// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { buildRegistryAccessors } from '@modules/forge/index'
import { createProposalEngine } from '@modules/forge/proposal-engine'
import { createProposalApplier } from '@modules/forge/applier'
import type { FrictionPattern, ForgeProposal, CreateProposalInput } from '@modules/forge/types'

// Replicates the service *wrappers* the tools/skills modules publish on the
// context: ctx.tools = { registry, executor, suggester }, ctx.skills = { loader, matcher }.
// The forge bug was wiring these wrappers (no .get) straight into the engine/applier.
function makeToolWrapper(tool?: { name: string; description: string }) {
  const store = new Map<string, { name: string; description: string }>()
  if (tool) store.set(tool.name, tool)
  return {
    registry: {
      get: (name: string) => store.get(name),
      register: vi.fn(),
      list: vi.fn(),
    },
    executor: {},
    suggester: {},
  }
}

function makeSkillWrapper(skill?: { id: string; name: string; description: string; content: string }) {
  return {
    loader: {
      get: (id: string) => (skill && skill.id === id ? skill : null),
    },
    matcher: {},
  }
}

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

const toolPattern: FrictionPattern = {
  target: 'tool', targetId: 'tool-search',
  frictionCount: 6, totalUsages: 10, frictionRate: 0.6,
  topFrictions: ['Too slow'], topSuggestions: ['Use cached results'],
  sampleFeedbackIds: ['fb-1'],
}

const skillPattern: FrictionPattern = {
  target: 'skill', targetId: 'sk-1',
  frictionCount: 4, totalUsages: 8, frictionRate: 0.5,
  topFrictions: ['Ambiguous'], topSuggestions: ['Clarify steps'],
  sampleFeedbackIds: ['fb-2'],
}

describe('Forge — registry/skill accessor wiring', () => {
  it('toolRegistry accessor delegates to ctx.tools.registry.get (not the wrapper)', () => {
    const ctx: any = { tools: makeToolWrapper({ name: 'tool-search', description: 'Search files' }) }
    const { toolRegistry } = buildRegistryAccessors(ctx)
    expect(typeof toolRegistry.get).toBe('function')
    expect(toolRegistry.get('tool-search')).toEqual({ name: 'tool-search', description: 'Search files' })
  })

  it('resolves lazily — skills registered AFTER forge onRegister still resolve', () => {
    const ctx: any = { tools: makeToolWrapper() } // ctx.skills not present yet (forge registers before skills)
    const { skillRegistry } = buildRegistryAccessors(ctx)
    // At build time there is no skills wrapper — must not throw, must return undefined.
    expect(skillRegistry.get('sk-1')).toBeUndefined()
    // skills module publishes its wrapper later:
    ctx.skills = makeSkillWrapper({ id: 'sk-1', name: 'Skill One', description: 'Old', content: 'body' })
    expect(skillRegistry.get('sk-1')).toMatchObject({ id: 'sk-1', description: 'Old' })
  })

  it('accessors are safe when tools/skills are entirely absent', () => {
    const { toolRegistry, skillRegistry } = buildRegistryAccessors({} as any)
    expect(toolRegistry.get('x')).toBeUndefined()
    expect(skillRegistry.get('x')).toBeUndefined()
    expect(() => toolRegistry.updateDescription('x', 'y')).not.toThrow()
  })

  it('REGRESSION: proposal engine no longer crashes on a tool friction pattern', async () => {
    // Before the fix, forge passed ctx.tools (the wrapper, no .get) so the engine
    // threw "deps.toolRegistry.get is not a function" on every tool pattern.
    const ctx: any = { tools: makeToolWrapper({ name: 'tool-search', description: 'Search files' }) }
    const { toolRegistry, skillRegistry } = buildRegistryAccessors(ctx)
    const store = mockProposalStore(false)
    const engine = createProposalEngine(store as any, { toolRegistry, skillRegistry })

    const proposals = await engine.generateFromFriction(toolPattern)
    expect(proposals).toHaveLength(1)
    const addArg = store.add.mock.calls[0][0]
    expect(addArg.currentValue).toBe('Search files') // resolved from the real registry
  })

  it('proposal engine resolves skill currentValue from the loader', async () => {
    const ctx: any = {
      tools: makeToolWrapper(),
      skills: makeSkillWrapper({ id: 'sk-1', name: 'Skill One', description: 'Skill desc', content: 'body' }),
    }
    const { toolRegistry, skillRegistry } = buildRegistryAccessors(ctx)
    const store = mockProposalStore(false)
    const engine = createProposalEngine(store as any, { toolRegistry, skillRegistry })

    await engine.generateFromFriction(skillPattern)
    expect(store.add.mock.calls[0][0].currentValue).toBe('Skill desc')
  })

  it('applier applies a tool description change against the live tool object', () => {
    const tool = { name: 'tool-search', description: 'Old desc' }
    const ctx: any = { tools: makeToolWrapper(tool) }
    const { toolRegistry, skillRegistry } = buildRegistryAccessors(ctx)
    const applier = createProposalApplier({ toolRegistry, skillRegistry })

    const proposal: ForgeProposal = {
      id: 'p-1', target: 'tool', targetId: 'tool-search', scope: 'description',
      title: 't', description: 'd', currentValue: 'Old desc', proposedValue: 'New desc',
      reasoning: 'r', confidence: 0.9, basedOnFeedbacks: 5, status: 'approved',
      experimentId: null, createdAt: new Date().toISOString(), reviewedAt: null,
    }

    const result = applier.apply(proposal)
    expect(result.success).toBe(true)
    // Live registry object mutated → new description is what tool definitions will expose.
    expect(ctx.tools.registry.get('tool-search')!.description).toBe('New desc')
  })
})
