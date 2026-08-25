// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createAgentResolver } from '@modules/agent/agent-resolver'

describe('AgentResolver', () => {
  function makeResolver(overrides: any = {}) {
    return createAgentResolver({
      getAgent: overrides.getAgent ?? vi.fn().mockReturnValue(undefined),
      getProject: overrides.getProject ?? vi.fn().mockReturnValue(null),
      getProjectType: overrides.getProjectType ?? vi.fn().mockReturnValue(null),
      listPrimaryAgents: overrides.listPrimaryAgents ?? vi.fn().mockReturnValue([]),
    })
  }

  it('returns conversation-level agentId first', () => {
    const resolver = makeResolver({
      getAgent: vi.fn().mockReturnValue({ id: 'conv-agent' }),
    })
    const result = resolver.resolve({ agentId: 'conv-agent', projectId: null })
    expect(result).toBe('conv-agent')
  })

  it('falls back to project defaultAgentId', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: 'proj-agent', typeId: null }),
      getAgent: vi.fn().mockImplementation((id: string) => id === 'proj-agent' ? { id: 'proj-agent' } : undefined),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('proj-agent')
  })

  it('falls back to projectType defaultAgentId', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: null, typeId: 'type-1' }),
      getProjectType: vi.fn().mockReturnValue({ defaultAgentId: 'type-agent' }),
      getAgent: vi.fn().mockImplementation((id: string) => id === 'type-agent' ? { id: 'type-agent' } : undefined),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('type-agent')
  })

  it('falls back to first enabled primary agent', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: null, typeId: null }),
      listPrimaryAgents: vi.fn().mockReturnValue([{ id: 'primary-1', enabled: true }]),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('primary-1')
  })

  it('returns null when no agent found', () => {
    const resolver = makeResolver()
    const result = resolver.resolve({ agentId: null, projectId: null })
    expect(result).toBeNull()
  })
})
