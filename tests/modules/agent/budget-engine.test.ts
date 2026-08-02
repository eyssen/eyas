import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBudgetEngine } from '@modules/agent/budget-engine'
import type { AgentRegistry } from '@modules/agent/agent-registry'
import type { AgentDefinition } from '@modules/agent/types'

// ─── Mock Registry ───────────────────────────

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    role: 'assistant',
    description: 'Test',
    goal: 'Test',
    backstory: '',
    tier: 'primary',
    agentType: 'assistant',
    systemPrompt: '',
    capabilities: [],
    tools: [],
    constraints: [],
    enabled: true,
    source: 'user',
    monthlyTokenBudget: 100_000,
    tokensUsedThisMonth: 0,
    ...overrides,
  }
}

function createMockRegistry(agents: AgentDefinition[]): AgentRegistry {
  const store = new Map(agents.map(a => [a.id, { ...a }]))

  return {
    create: vi.fn(),
    get: vi.fn((id: string) => {
      const a = store.get(id)
      return a ? { ...a } : undefined
    }),
    list: vi.fn(() => [...store.values()]),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
    getByCapability: vi.fn(() => []),
    addTokenUsage: vi.fn((id: string, tokens: number) => {
      const a = store.get(id)
      if (a) a.tokensUsedThisMonth = (a.tokensUsedThisMonth ?? 0) + tokens
    }),
    isWithinBudget: vi.fn((id: string) => {
      const a = store.get(id)
      if (!a) return false
      if (!a.monthlyTokenBudget || a.monthlyTokenBudget === 0) return true
      return (a.tokensUsedThisMonth ?? 0) < a.monthlyTokenBudget
    }),
    resetMonthlyBudgets: vi.fn(() => {
      for (const a of store.values()) a.tokensUsedThisMonth = 0
    }),
    seedFromDirectory: vi.fn(async () => 0),
  }
}

// ─── Tests ───────────────────────────────────

describe('BudgetEngine', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let bus: { emit: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    registry = createMockRegistry([
      makeAgent({ id: 'agent-1', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
      makeAgent({ id: 'agent-2', monthlyTokenBudget: 0, tokensUsedThisMonth: 5000 }),
      makeAgent({ id: 'agent-3', monthlyTokenBudget: 50_000, tokensUsedThisMonth: 45_000 }),
    ])
    bus = { emit: vi.fn() }
  })

  describe('trackUsage', () => {
    it('delegates to registry.addTokenUsage', () => {
      const engine = createBudgetEngine({ registry, bus })
      engine.trackUsage('agent-1', 500)
      expect(registry.addTokenUsage).toHaveBeenCalledWith('agent-1', 500)
    })

    it('emits warning alert when usage crosses 80%', () => {
      const engine = createBudgetEngine({ registry, bus })
      // Set agent to 85k of 100k (85%)
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)

      expect(bus.emit).toHaveBeenCalledWith('eyas.agent.budget.alert', expect.objectContaining({
        level: 'warning',
        agentId: 'agent-1',
      }))
    })

    it('emits exceeded alert at 100%+', () => {
      const engine = createBudgetEngine({ registry, bus })
      registry.addTokenUsage('agent-1', 105_000)
      engine.trackUsage('agent-1', 0)

      expect(bus.emit).toHaveBeenCalledWith('eyas.agent.budget.alert', expect.objectContaining({
        level: 'exceeded',
      }))
    })

    it('emits critical alert at 120%+', () => {
      const engine = createBudgetEngine({ registry, bus })
      registry.addTokenUsage('agent-1', 125_000)
      engine.trackUsage('agent-1', 0)

      expect(bus.emit).toHaveBeenCalledWith('eyas.agent.budget.alert', expect.objectContaining({
        level: 'critical',
      }))
    })

    it('does not emit duplicate alerts for same level', () => {
      const engine = createBudgetEngine({ registry, bus })
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      engine.trackUsage('agent-1', 0)

      // Should only emit once
      const alertCalls = bus.emit.mock.calls.filter(c => c[0] === 'eyas.agent.budget.alert')
      expect(alertCalls).toHaveLength(1)
    })

    it('does not emit alert for unlimited budget agent', () => {
      const engine = createBudgetEngine({ registry, bus })
      engine.trackUsage('agent-2', 1_000_000)
      expect(bus.emit).not.toHaveBeenCalled()
    })
  })

  describe('canExecute', () => {
    it('returns true when within budget', () => {
      const engine = createBudgetEngine({ registry })
      expect(engine.canExecute('agent-1')).toBe(true)
    })

    it('returns false when over budget', () => {
      const engine = createBudgetEngine({ registry })
      registry.addTokenUsage('agent-1', 100_001)
      expect(engine.canExecute('agent-1')).toBe(false)
    })

    it('returns true for unlimited budget', () => {
      const engine = createBudgetEngine({ registry })
      expect(engine.canExecute('agent-2')).toBe(true)
    })
  })

  describe('getStats', () => {
    it('returns null for unknown agent', () => {
      const engine = createBudgetEngine({ registry })
      expect(engine.getStats('nonexistent')).toBeNull()
    })

    it('returns correct stats for agent within budget', () => {
      const engine = createBudgetEngine({ registry })
      const stats = engine.getStats('agent-1')!

      expect(stats.agentId).toBe('agent-1')
      expect(stats.monthlyBudget).toBe(100_000)
      expect(stats.tokensUsed).toBe(0)
      expect(stats.isOverBudget).toBe(false)
      expect(stats.alertLevel).toBe('normal')
    })

    it('returns warning alert level for 80-99%', () => {
      const engine = createBudgetEngine({ registry })
      const stats = engine.getStats('agent-3')!

      // agent-3: 45k/50k = 90%
      expect(stats.alertLevel).toBe('warning')
      expect(stats.percentage).toBeCloseTo(90, 0)
    })

    it('calculates projection based on usage', () => {
      const engine = createBudgetEngine({ registry })
      const stats = engine.getStats('agent-3')!

      expect(stats.projectedMonthly).toBeGreaterThan(0)
      expect(stats.daysIntoMonth).toBeGreaterThan(0)
    })
  })

  describe('getAllStats', () => {
    it('only returns agents with budgets', () => {
      const engine = createBudgetEngine({ registry })
      const all = engine.getAllStats()

      // agent-2 has budget=0 (unlimited) — should be excluded
      expect(all).toHaveLength(2)
      expect(all.map(s => s.agentId)).toContain('agent-1')
      expect(all.map(s => s.agentId)).toContain('agent-3')
      expect(all.map(s => s.agentId)).not.toContain('agent-2')
    })
  })

  describe('resetAll', () => {
    it('resets monthly budgets and clears alerts', () => {
      const engine = createBudgetEngine({ registry, bus })

      // Trigger an alert first
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(bus.emit).toHaveBeenCalled()

      // Reset
      engine.resetAll()
      expect(registry.resetMonthlyBudgets).toHaveBeenCalled()

      // After reset, same alert level should fire again (alerts cleared)
      bus.emit.mockClear()
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(bus.emit).toHaveBeenCalled()
    })
  })
})
