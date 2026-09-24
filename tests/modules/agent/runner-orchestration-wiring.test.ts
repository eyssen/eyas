// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — the agent module hands its runner the persisting orchestration sink
// (ctx.orchestration, created later in onStart) through a lazy getter, and the
// configured pricing, so every run with a conversation emits its run tree.

import { describe, it, expect, vi } from 'vitest'

const captured: { deps?: any } = {}

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: (deps: any) => {
    captured.deps = deps
    return { run: vi.fn() }
  },
}))

import { agentModule } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function boot() {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  return ctx
}

describe('agent module → runner run-tree wiring (G6)', () => {
  it('reads ctx.orchestration when a run starts, not when the runner is built', async () => {
    const ctx = await boot()
    delete ctx.orchestration
    expect(captured.deps.getOrchestrationSink()).toBeUndefined()

    const sink = { emit: vi.fn(), latestSeq: vi.fn(() => 0) }
    ctx.orchestration = sink
    expect(captured.deps.getOrchestrationSink()).toBe(sink)
  })

  it('prices runs with the live config.model.pricing', async () => {
    const ctx = await boot()
    expect(captured.deps.pricingOverrides).toBeUndefined()
    ctx.config = { model: { pricing: { 'anthropic/x': { input: 1, output: 2 } } } }
    expect(captured.deps.pricingOverrides).toEqual({ 'anthropic/x': { input: 1, output: 2 } })
  })
})
