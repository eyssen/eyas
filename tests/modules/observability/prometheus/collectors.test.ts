// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import type { EyasBus, BusSubscription } from '@core/types'
import type { Logger } from 'pino'
import { Registry } from '@modules/observability/prometheus/registry'
import {
  registerAgentMetrics,
  registerToolMetrics,
  registerModelMetrics,
  registerHttpMetrics,
  registerRuntimeMetrics,
} from '@modules/observability/prometheus/collectors'

// Minimal synchronous bus implementation that awaits handlers.
function createTestBus(): EyasBus & { flush: () => Promise<void> } {
  const handlers = new Map<string, Set<(data: unknown) => Promise<void>>>()
  const pending: Promise<void>[] = []
  const bus: EyasBus & { flush: () => Promise<void> } = {
    emit(subject, data) {
      const set = handlers.get(subject)
      if (!set) return
      for (const h of set) {
        pending.push(h(data).catch(() => {}))
      }
    },
    on(subject, handler): BusSubscription {
      let set = handlers.get(subject)
      if (!set) {
        set = new Set()
        handlers.set(subject, set)
      }
      set.add(handler)
      return {
        subject,
        id: subject,
        unsubscribe: () => set!.delete(handler),
      }
    },
    off(sub) {
      sub.unsubscribe()
    },
    async flush() {
      await Promise.all(pending.splice(0, pending.length))
    },
  }
  return bus
}

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
} as unknown as Logger

describe('agent-metrics collector', () => {
  let registry: Registry
  let bus: ReturnType<typeof createTestBus>

  beforeEach(() => {
    registry = new Registry()
    bus = createTestBus()
    registerAgentMetrics(registry, bus, testLogger)
  })

  it('counts sessions by status', async () => {
    bus.emit('agent.session.completed', { status: 'completed' })
    bus.emit('agent.session.completed', { status: 'completed' })
    bus.emit('agent.session.failed', {})
    await bus.flush()
    const sessions = registry.get('eyas_agent_sessions_total')
    expect(sessions).toBeDefined()
    expect((sessions as any).get({ status: 'completed' })).toBe(2)
    expect((sessions as any).get({ status: 'failed' })).toBe(1)
  })

  it('accumulates tokens and cost', async () => {
    bus.emit('agent.tokens.used', {
      agentId: 'a1',
      provider: 'anthropic',
      kind: 'output',
      amount: 500,
    })
    bus.emit('agent.tokens.used', {
      agentId: 'a1',
      provider: 'anthropic',
      kind: 'output',
      amount: 100,
    })
    bus.emit('agent.cost.charged', { agentId: 'a1', usd: 0.02 })
    await bus.flush()
    const tokens = registry.get('eyas_agent_tokens_total') as any
    expect(
      tokens.get({ agent_id: 'a1', provider: 'anthropic', kind: 'output' }),
    ).toBe(600)
    const cost = registry.get('eyas_agent_cost_usd_total') as any
    expect(cost.get({ agent_id: 'a1' })).toBeCloseTo(0.02)
  })

  it('tracks budget ratio and active teams via gauges', async () => {
    bus.emit('agent.budget.updated', { agentId: 'a1', ratio: 0.7 })
    bus.emit('team.active.count', { count: 4 })
    await bus.flush()
    expect((registry.get('eyas_agent_budget_usage_ratio') as any).get({ agent_id: 'a1' })).toBe(0.7)
    expect((registry.get('eyas_active_teams_total') as any).get({})).toBe(4)
  })
})

describe('tool-metrics collector', () => {
  it('counts calls and observes duration', async () => {
    const registry = new Registry()
    const bus = createTestBus()
    registerToolMetrics(registry, bus, testLogger)

    bus.emit('tool.executed', { toolName: 'shell', result: 'success', durationMs: 42 })
    bus.emit('tool.executed', { toolName: 'shell', result: 'error', durationMs: 700 })
    await bus.flush()

    const calls = registry.get('eyas_tool_calls_total') as any
    expect(calls.get({ tool_name: 'shell', result: 'success' })).toBe(1)
    expect(calls.get({ tool_name: 'shell', result: 'error' })).toBe(1)

    const dur = registry.get('eyas_tool_duration_ms') as any
    const fam = dur.collect()
    expect(fam.histogramSamples[0].count).toBe(2)
    expect(fam.histogramSamples[0].sum).toBe(742)
  })
})

describe('model-metrics collector', () => {
  it('counts provider calls and observes latency', async () => {
    const registry = new Registry()
    const bus = createTestBus()
    registerModelMetrics(registry, bus, testLogger)
    bus.emit('model.call.completed', {
      provider: 'anthropic',
      model: 'claude-opus',
      outcome: 'success',
      latencyMs: 1234,
    })
    await bus.flush()
    expect(
      (registry.get('eyas_model_calls_total') as any).get({
        provider: 'anthropic',
        model: 'claude-opus',
        outcome: 'success',
      }),
    ).toBe(1)
  })
})

describe('http-metrics collector', () => {
  it('uses route pattern (not raw URL)', async () => {
    const registry = new Registry()
    const bus = createTestBus()
    registerHttpMetrics(registry, bus, testLogger)
    bus.emit('http.request.completed', {
      method: 'get',
      route: '/api/v1/users/:id',
      status: 200,
      durationMs: 12,
    })
    await bus.flush()
    expect(
      (registry.get('eyas_http_requests_total') as any).get({
        method: 'GET',
        route: '/api/v1/users/:id',
        status: '200',
      }),
    ).toBe(1)
  })
})

describe('runtime-metrics collector', () => {
  it('registers static and dynamic gauges', () => {
    const registry = new Registry()
    const bus = createTestBus()
    const rm = registerRuntimeMetrics(registry, bus, testLogger, {
      intervalMs: 100_000, // effectively never during test
    })
    expect(registry.get('eyas_process_start_time_seconds')).toBeDefined()
    expect(registry.get('eyas_process_resident_memory_bytes')).toBeDefined()
    rm.collect()
    rm.stop()
  })

  it('reflects scheduler leader events', async () => {
    const registry = new Registry()
    const bus = createTestBus()
    const rm = registerRuntimeMetrics(registry, bus, testLogger, { intervalMs: 100_000 })
    bus.emit('scheduler.leader.changed', { instanceId: 'inst-a', isLeader: true })
    bus.emit('scheduler.leader.changed', { instanceId: 'inst-b', isLeader: false })
    await bus.flush()
    expect((registry.get('eyas_scheduler_leader') as any).get({ instance_id: 'inst-a' })).toBe(1)
    expect((registry.get('eyas_scheduler_leader') as any).get({ instance_id: 'inst-b' })).toBe(0)
    rm.stop()
  })
})
