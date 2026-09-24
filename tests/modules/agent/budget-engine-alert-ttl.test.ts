// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBudgetEngine } from '@modules/agent/budget-engine'
import type { AgentRegistry } from '@modules/agent/agent-registry'
import type { AgentDefinition } from '@modules/agent/types'

// ─── Mock Registry (same style as budget-engine.test.ts) ────────────

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
    /** Helper for tests: directly set tokensUsedThisMonth. */
    setUsage(id: string, tokens: number) {
      const a = store.get(id)
      if (a) a.tokensUsedThisMonth = tokens
    },
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
  } as unknown as AgentRegistry & { setUsage(id: string, tokens: number): void }
}

function countBudgetAlerts(bus: { emit: ReturnType<typeof vi.fn> }): number {
  return bus.emit.mock.calls.filter(c => c[0] === 'eyas.agent.budget.alert').length
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('BudgetEngine — alert TTL + LRU (S6)', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let bus: { emit: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    registry = createMockRegistry([
      makeAgent({ id: 'agent-1', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
      makeAgent({ id: 'agent-2', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
    ])
    bus = { emit: vi.fn() }
  })

  describe('TTL-based dedup', () => {
    it('fires once then dedups within TTL', () => {
      let fakeNow = 1_000_000
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fakeNow,
        alertTtlMs: 60_000, // 1 minute
      })

      // Bump to 85% → warning band
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1)

      // Advance 30s (still within 60s TTL); same band → should be deduped
      fakeNow += 30_000
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1)
    })

    it('fires again after TTL elapses', () => {
      let fakeNow = 1_000_000
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fakeNow,
        alertTtlMs: 60_000,
      })

      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1)

      // Advance past the TTL (61s)
      fakeNow += 61_000
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(2)
    })
  })

  describe('band transitions', () => {
    it('dropping from warning to normal clears dedup — next warning re-alerts', () => {
      let fakeNow = 1_000_000
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fakeNow,
        alertTtlMs: 24 * 60 * 60 * 1000,
      })

      // Warning band
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1)

      // Drop back to normal (e.g. budget reset or usage lowered)
      ;(registry as any).setUsage('agent-1', 10_000) // 10% → normal
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1) // no new alert for normal

      // Re-enter warning band — should fire again because dedup was cleared
      ;(registry as any).setUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(2)
    })

    it('dropping from critical to warning clears critical entry (warning remains deduped)', () => {
      let fakeNow = 1_000_000
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fakeNow,
        alertTtlMs: 24 * 60 * 60 * 1000,
      })

      // Critical (>=120%). Going to critical from 0% crosses warning and exceeded too,
      // but only the current band (critical) is alerted per call.
      ;(registry as any).setUsage('agent-1', 125_000) // 125% → critical
      engine.trackUsage('agent-1', 0)
      const afterCritical = countBudgetAlerts(bus)
      expect(afterCritical).toBeGreaterThanOrEqual(1)
      const lastEvent = bus.emit.mock.calls.at(-1)![1] as { level: string }
      expect(lastEvent.level).toBe('critical')

      // Now manually fire warning too to populate both entries
      ;(registry as any).setUsage('agent-1', 85_000) // 85% → warning
      engine.trackUsage('agent-1', 0)
      // Should emit a new warning alert (different band). Critical entry should be cleared.
      const lastEvent2 = bus.emit.mock.calls.at(-1)![1] as { level: string }
      expect(lastEvent2.level).toBe('warning')

      // Jump back into critical → should fire a NEW critical alert because the
      // critical entry was cleared when usage dropped below critical.
      ;(registry as any).setUsage('agent-1', 130_000)
      engine.trackUsage('agent-1', 0)
      const criticals = bus.emit.mock.calls
        .map(c => c[1] as { level: string })
        .filter(e => e.level === 'critical')
      expect(criticals.length).toBeGreaterThanOrEqual(2)

      // Meanwhile, the warning band stays deduped: dropping back to 85% should NOT fire warning again.
      ;(registry as any).setUsage('agent-1', 85_000)
      const warningsBefore = bus.emit.mock.calls
        .map(c => c[1] as { level: string })
        .filter(e => e.level === 'warning').length
      engine.trackUsage('agent-1', 0)
      const warningsAfter = bus.emit.mock.calls
        .map(c => c[1] as { level: string })
        .filter(e => e.level === 'warning').length
      expect(warningsAfter).toBe(warningsBefore)
    })
  })

  describe('LRU cap (maxAlerts)', () => {
    it('evicts the oldest entry when maxAlerts exceeded', () => {
      // maxAlerts=2: after 3 distinct (agent, level) alerts, the first one must be evicted.
      let fakeNow = 1_000_000
      const reg = createMockRegistry([
        makeAgent({ id: 'a1', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
        makeAgent({ id: 'a2', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
        makeAgent({ id: 'a3', monthlyTokenBudget: 100_000, tokensUsedThisMonth: 0 }),
      ])
      const localBus = { emit: vi.fn() }
      const engine = createBudgetEngine({
        registry: reg,
        bus: localBus,
        now: () => fakeNow,
        alertTtlMs: 24 * 60 * 60 * 1000,
        maxAlerts: 2,
      })

      // Alert for a1 (warning) — inserted first
      ;(reg as any).setUsage('a1', 85_000)
      engine.trackUsage('a1', 0)
      // Alert for a2 (warning) — inserted second
      ;(reg as any).setUsage('a2', 85_000)
      engine.trackUsage('a2', 0)
      // Alert for a3 (warning) — evicts the oldest (a1:warning)
      ;(reg as any).setUsage('a3', 85_000)
      engine.trackUsage('a3', 0)

      expect(countBudgetAlerts(localBus)).toBe(3)

      // a2 is still in the dedup map — re-calling should NOT emit a new alert.
      const beforeA2 = countBudgetAlerts(localBus)
      engine.trackUsage('a2', 0)
      expect(countBudgetAlerts(localBus)).toBe(beforeA2)

      // a1 was evicted — re-alerting it should fire again.
      ;(reg as any).setUsage('a1', 85_000)
      engine.trackUsage('a1', 0)
      expect(countBudgetAlerts(localBus)).toBe(beforeA2 + 1)
    })
  })

  describe('resetAll', () => {
    it('clears all alert entries', () => {
      let fakeNow = 1_000_000
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fakeNow,
        alertTtlMs: 24 * 60 * 60 * 1000,
      })

      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(1)

      engine.resetAll()

      // Simulate month-start: registry resets tokens too. Push back to warning.
      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)
      expect(countBudgetAlerts(bus)).toBe(2)
    })
  })

  describe('mock now injection', () => {
    it('uses the injected now function for timestamps', () => {
      const fixedNow = 1_700_000_000_000 // fixed epoch
      const engine = createBudgetEngine({
        registry,
        bus,
        now: () => fixedNow,
        alertTtlMs: 60_000,
      })

      registry.addTokenUsage('agent-1', 85_000)
      engine.trackUsage('agent-1', 0)

      const alertPayload = bus.emit.mock.calls.find(
        c => c[0] === 'eyas.agent.budget.alert',
      )![1] as { timestamp: string }
      expect(alertPayload.timestamp).toBe(new Date(fixedNow).toISOString())
    })
  })
})
