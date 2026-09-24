// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../helpers/claude-runtime.js'
import { applyAnthropicReasoning } from '@modules/model/submodules/anthropic/adapter.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import { UNKNOWN_CAPABILITY } from '@modules/model/reasoning/capability.js'
import type { EffortPlan } from '@modules/model/reasoning/resolve.js'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider.js'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider.js'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog.js'
import { installOpenAIWire, okCompletion, type OpenAIWire } from '../../helpers/openai-wire.js'
import { effortPlanFor, ADAPTIVE_EFFORT_CAPABILITY } from '../../helpers/effort-plan.js'

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const base = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

// ─── Claude Code (F5) ──────────────────────────────────────────────────────
// The gateway's plan is resolved against the capability the registry merges
// from what discovery on the RUNNING binary stored (model_config metadata)
// over the bundled overlay; the provider then sends only what that binary
// reported for the model.
describe('claude-code provider — effort mapping', () => {
  const RUNTIME = { ...TEST_CLAUDE_RUNTIME, version: '2.1.281' }
  const discovered = (levels: string[], adaptiveThinking = true, runtime = RUNTIME.version) => ({
    source: 'sdk' as const, param: 'effort' as const, levels: levels as any, adaptiveThinking, runtime, discoveredAt: '2026-09-23T00:00:00.000Z',
  })
  const ROWS: Record<string, { alias: string; realModelId: string; reasoning?: any }> = {
    'claude-code-opus': { alias: 'opus', realModelId: 'claude-opus-5-5', reasoning: discovered(['low', 'medium', 'high', 'xhigh', 'max']) },
    'claude-code-opus-4-8': { alias: 'claude-opus-4-8', realModelId: 'claude-opus-4-8', reasoning: discovered(['low', 'medium', 'high', 'xhigh', 'max']) },
    'claude-code-sonnet': { alias: 'sonnet', realModelId: 'claude-sonnet-4-6', reasoning: discovered(['low', 'medium', 'high', 'max']) },
    'claude-code-haiku': { alias: 'haiku', realModelId: 'claude-haiku-4-5', reasoning: { source: 'sdk', param: 'none', levels: [], runtime: RUNTIME.version, discoveredAt: '2026-09-23T00:00:00.000Z' } },
    // A first-boot seed row: nothing discovered yet.
    'claude-code-fable': { alias: 'fable', realModelId: 'claude-fable-5-1' },
  }
  const registry = createReasoningRegistry({
    overlay: loadBundledOverlay(),
    getDiscovered: (_p, m) => ROWS[m]?.reasoning ?? null,
    getRealModelId: (_p, m) => ROWS[m]?.realModelId,
  })
  const planOf = (model: string, level: Parameters<typeof effortPlanFor>[0]) =>
    effortPlanFor(level, registry.get('claude-code', model), { maxOutputTokens: 128_000 })
  const provider = (runtime = RUNTIME, rows = ROWS) =>
    createClaudeCodeProvider({ runtime, lookupModelMetadata: (id) => rows[id] ?? null })
  const send = async (model: string, effortPlan: EffortPlan | undefined, p = provider()) => {
    await drain(p.stream({ ...base, model, effortPlan } as any))
    return h.captured.options
  }

  beforeEach(() => { h.captured.options = undefined })

  // Positive
  it("'xhigh' is sent for Opus 5.5 when the runtime reported it, with adaptive thinking and the summarized display", async () => {
    const o = await send('claude-code-opus', planOf('claude-code-opus', 'xhigh'))
    expect(o.model).toBe('opus')
    expect(o.effort).toBe('xhigh')
    expect(o.thinking).toEqual({ type: 'adaptive' })
    expect(o.extraArgs).toEqual({ 'thinking-display': 'summarized' })
  })

  it("Sonnet 4.6 'max' sends the level and adaptive thinking, without the display flag it does not need", async () => {
    const o = await send('claude-code-sonnet', planOf('claude-code-sonnet', 'max'))
    expect(o.effort).toBe('max')
    expect(o.thinking).toEqual({ type: 'adaptive' })
    expect(o.extraArgs).toBeUndefined()
  })

  it("'none' on a model that can switch reasoning off sends thinking disabled and no effort", async () => {
    const o = await send('claude-code-opus-4-8', planOf('claude-code-opus-4-8', 'none'))
    expect(o.thinking).toEqual({ type: 'disabled' })
    expect('effort' in o).toBe(false)
  })

  // Negative
  it("'auto' sends neither effort nor a thinking switch (the model's own default runs)", async () => {
    const o = await send('claude-code-opus', planOf('claude-code-opus', 'auto'))
    expect('effort' in o).toBe(false)
    expect('thinking' in o).toBe(false)
    // Without a plan at all (a direct call) nothing reasoning-related is sent.
    const plain = await send('claude-code-opus', undefined)
    expect('effort' in plain).toBe(false)
    expect('thinking' in plain).toBe(false)
    expect('extraArgs' in plain).toBe(false)
  })

  it("'none' on a model that cannot switch reasoning off never sends thinking disabled", async () => {
    // The gateway clamps it to the lowest level Opus 5.5 runs.
    const o = await send('claude-code-opus', planOf('claude-code-opus', 'none'))
    expect(o.effort).toBe('low')
    expect(o.thinking).not.toEqual({ type: 'disabled' })
    // A plan that still says 'none' for such a model sends nothing at all.
    const stale = await send('claude-code-opus', { ...planOf('claude-code-opus', 'low'), level: 'none', thinking: 'off' })
    expect('thinking' in stale).toBe(false)
    expect('effort' in stale).toBe(false)
  })

  it('an undiscovered level is never sent: clamped to what the runtime reported, nothing without a report', async () => {
    // A plan resolved against a capability that claims xhigh for Sonnet 4.6.
    const claimsXhigh = effortPlanFor('xhigh', { ...ADAPTIVE_EFFORT_CAPABILITY, levels: ['low', 'medium', 'high', 'xhigh', 'max'], canDisable: false })
    const o = await send('claude-code-sonnet', claimsXhigh)
    expect(o.effort).toBe('high')
    // A seed row with no discovered reasoning: the plan's level is not sent.
    const seed = await send('claude-code-fable', effortPlanFor('high'))
    expect('effort' in seed).toBe(false)
    expect('thinking' in seed).toBe(false)
    // The runtime offers no effort for Haiku: the gateway resolves Auto, and nothing is sent.
    expect(planOf('claude-code-haiku', 'high').level).toBe('auto')
    const haiku = await send('claude-code-haiku', effortPlanFor('high'))
    expect('effort' in haiku).toBe(false)
  })

  it('levels stored by another runtime version are not trusted until rediscovery', async () => {
    const rows = { ...ROWS, 'claude-code-opus': { ...ROWS['claude-code-opus'], reasoning: discovered(['low', 'medium', 'high', 'xhigh', 'max'], true, '2.1.280') } }
    const o = await send('claude-code-opus', planOf('claude-code-opus', 'xhigh'), provider(RUNTIME, rows))
    expect('effort' in o).toBe(false)
  })

  it('the display flag only goes to a runtime that has it (the SDK-bundled 2.1.89 does not)', async () => {
    const old = { ...TEST_CLAUDE_RUNTIME, version: '2.1.89' }
    const rows = { ...ROWS, 'claude-code-opus': { ...ROWS['claude-code-opus'], reasoning: discovered(['low', 'medium', 'high', 'max'], true, '2.1.89') } }
    const o = await send('claude-code-opus', planOf('claude-code-opus', 'high'), provider(old, rows))
    expect(o.effort).toBe('high')
    expect('extraArgs' in o).toBe(false)
  })

  it('ignores the raw effort intent on the request: only the plan counts', async () => {
    await drain(provider().stream({ ...base, model: 'claude-code-opus', effort: { level: 'high', source: 'request' } } as any))
    expect('effort' in h.captured.options).toBe(false)
    expect('thinking' in h.captured.options).toBe(false)
  })
})

// ─── Anthropic API + anthropic-compat (F6) ─────────────────────────────────
// The mapper translates the gateway's plan, resolved against the REAL
// capability record (bundled overlay; no discovery), exactly as the gateway
// would for each model.
describe('anthropic adapter — capability-driven reasoning mapping', () => {
  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const OUTPUT_CAP: Record<string, number> = { 'claude-haiku-4-5': 64_000 }
  const planOf = (model: string, level: Parameters<typeof effortPlanFor>[0], streaming = true) =>
    effortPlanFor(level, registry.get('anthropic', model), { maxOutputTokens: OUTPUT_CAP[model] ?? 128_000, streaming })
  const mapped = (model: string, level: Parameters<typeof effortPlanFor>[0], extra: Record<string, unknown> = {}) => {
    const params: Record<string, any> = { model, max_tokens: 4096, ...extra }
    applyAnthropicReasoning(params, planOf(model, level))
    return params
  }

  // Positive
  it("Opus 5.5 'xhigh' sends output_config.effort xhigh with adaptive, summarized thinking", () => {
    const params = mapped('claude-opus-5-5', 'xhigh')
    expect(params.output_config).toEqual({ effort: 'xhigh' })
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(params.max_tokens).toBeGreaterThan(4096)
  })

  it("Opus 4.8 'high' sends the effort plus adaptive/summarized thinking", () => {
    const params = mapped('claude-opus-4-8', 'high')
    expect(params.output_config).toEqual({ effort: 'high' })
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })

  it("Opus 5 'none' switches thinking off and sends no effort", () => {
    const params = mapped('claude-opus-5', 'none')
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.output_config).toBeUndefined()
  })

  it("Haiku 4.5 'medium' sends budget_tokens within [1024, max_tokens), raising max_tokens but not past the model's cap", () => {
    const params = mapped('claude-haiku-4-5', 'medium')
    expect(params.output_config).toBeUndefined()
    expect(params.thinking.type).toBe('enabled')
    expect(params.thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
    expect(params.thinking.budget_tokens).toBeLessThan(params.max_tokens)
    expect(params.max_tokens).toBeGreaterThan(4096)
    expect(params.max_tokens).toBeLessThanOrEqual(64_000)
  })

  it('temperature is kept on Sonnet 4.6 when thinking is not switched on (Auto and none)', () => {
    expect(mapped('claude-sonnet-4-6', 'auto', { temperature: 0.3 }).temperature).toBe(0.3)
    const off = mapped('claude-sonnet-4-6', 'none', { temperature: 0.3 })
    expect(off.temperature).toBe(0.3)
    expect(off.thinking).toEqual({ type: 'disabled' })
  })

  it('Sonnet 4.6 takes its levels without the display parameter (it streams summaries by default)', () => {
    const params = mapped('claude-sonnet-4-6', 'max')
    expect(params.output_config).toEqual({ effort: 'max' })
    expect(params.thinking).toEqual({ type: 'adaptive' })
  })

  // Negative
  it("Opus 5.5 'auto' sends no output_config (only adaptive/summarized, for visibility)", () => {
    const params = mapped('claude-opus-5-5', 'auto')
    expect(params.output_config).toBeUndefined()
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(params.max_tokens).toBe(4096)
  })

  it("Opus 4.8 'auto' sends no thinking and no effort (thinking is off by default there)", () => {
    const params = mapped('claude-opus-4-8', 'auto')
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toBeUndefined()
  })

  it('Fable never gets disabled thinking or budget_tokens — not even from a forged plan', () => {
    for (const model of ['claude-fable-5', 'claude-fable-5-1']) {
      for (const level of ['none', 'minimal', 'low', 'max'] as const) {
        const params = mapped(model, level)
        expect(params.thinking?.type).not.toBe('disabled')
        expect(params.thinking?.budget_tokens).toBeUndefined()
      }
      const capability = registry.get('anthropic', model)
      const forgedOff: EffortPlan = { level: 'none', thinking: 'off', samplingLocked: true, capability }
      const forgedBudget: EffortPlan = { level: 'high', thinking: 'on', budgetTokens: 8000, samplingLocked: true, capability }
      const off: Record<string, any> = { max_tokens: 4096 }
      applyAnthropicReasoning(off, forgedOff)
      expect(off.thinking).toBeUndefined()
      const budget: Record<string, any> = { max_tokens: 4096 }
      applyAnthropicReasoning(budget, forgedBudget)
      expect(budget.thinking).toEqual({ type: 'adaptive' })
    }
  })

  it('temperature, top_p and top_k are dropped on sampling-locked models, at every level', () => {
    for (const model of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5']) {
      for (const level of ['auto', 'low', 'high'] as const) {
        const params = mapped(model, level, { temperature: 0.2, top_p: 0.9, top_k: 5 })
        expect(params).not.toHaveProperty('temperature')
        expect(params).not.toHaveProperty('top_p')
        expect(params).not.toHaveProperty('top_k')
      }
    }
  })

  it('temperature is dropped next to explicit thinking even where sampling is allowed', () => {
    expect(mapped('claude-sonnet-4-6', 'high', { temperature: 0.3 })).not.toHaveProperty('temperature')
  })

  it('an unknown model gets no reasoning parameters, whatever was requested, and keeps its temperature', () => {
    for (const model of ['claude-unreleased-9', 'MiniMax-M2.5']) {
      for (const level of ['none', 'low', 'high', 'max'] as const) {
        const params: Record<string, any> = { model, max_tokens: 4096, temperature: 0.4 }
        applyAnthropicReasoning(params, effortPlanFor(level, { ...UNKNOWN_CAPABILITY, levels: [] }))
        expect(params).toEqual({ model, max_tokens: 4096, temperature: 0.4 })
      }
    }
  })

  it('a level the capability does not list is never sent (4.6 has no xhigh; budget models take no effort)', () => {
    const capability = registry.get('anthropic', 'claude-opus-4-6')
    const forged: EffortPlan = { level: 'xhigh', thinking: 'on', samplingLocked: false, capability }
    const params: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicReasoning(params, forged)
    expect(params).toEqual({ max_tokens: 4096 })
    expect(mapped('claude-haiku-4-5', 'high').output_config).toBeUndefined()
  })

  it('without a plan nothing reasoning-related is sent and sampling passes through', () => {
    const params: Record<string, any> = { max_tokens: 4096, temperature: 0.5 }
    applyAnthropicReasoning(params, undefined)
    expect(params).toEqual({ max_tokens: 4096, temperature: 0.5 })
  })
})

// ─── OpenAI wire family, openai dialect (F7) ───────────────────────────────
// The real SDK on a fake fetch: the body is exactly what reaches OpenAI. Plans
// are resolved against the REAL capability records (bundled overlay), as the
// gateway resolves them after routing.
describe('openai provider — per-model reasoning_effort from the capability', () => {
  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const planOf = (providerId: string, model: string, level: Parameters<typeof effortPlanFor>[0]) =>
    effortPlanFor(level, registry.get(providerId, model), { maxOutputTokens: 128_000 })
  let wire: OpenAIWire
  beforeEach(() => {
    wire = installOpenAIWire()
    wire.respondWith(okCompletion())
  })
  afterEach(() => wire.restore())

  async function sent(model: string, request: Record<string, unknown>, provider = createOpenAIProvider({ apiKey: 'test-key' })) {
    await provider.complete({ model, messages: [{ role: 'user', content: 'hi' }], ...request } as any)
    expect(wire.bodies).toHaveLength(1)
    return wire.bodies[0]
  }

  // Positive
  it("gpt-5.4 'none' sends reasoning_effort none with max_completion_tokens and no temperature", async () => {
    const body = await sent('gpt-5.4', { maxTokens: 2000, temperature: 0.2, effortPlan: planOf('openai', 'gpt-5.4', 'none') })
    expect(body.reasoning_effort).toBe('none')
    expect(body.max_completion_tokens).toBe(2000)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
  })

  it("gpt-5.6 'max' sends reasoning_effort max (untyped in the SDK, passed on the wire)", async () => {
    const body = await sent('gpt-5.6', { effortPlan: planOf('openai', 'gpt-5.6', 'max') })
    expect(body.reasoning_effort).toBe('max')
  })

  it("o3-mini 'high' sends reasoning_effort high, max_completion_tokens, no temperature", async () => {
    const body = await sent('o3-mini', { maxTokens: 500, temperature: 0.3, effortPlan: planOf('openai', 'o3-mini', 'high') })
    expect(body.reasoning_effort).toBe('high')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(500)
    expect(body).not.toHaveProperty('temperature')
  })

  it("the clamped level reaches the wire: 'max' on gpt-5.5 (tops out at xhigh) sends xhigh", async () => {
    const body = await sent('gpt-5.5', { effortPlan: planOf('openai', 'gpt-5.5', 'max') })
    expect(body.reasoning_effort).toBe('xhigh')
  })

  it("an explicit level raises a smaller output cap to the level's floor (reasoning tokens count against it)", async () => {
    const body = await sent('gpt-5.5', { maxTokens: 2000, effortPlan: planOf('openai', 'gpt-5.5', 'high') })
    expect(body.max_completion_tokens).toBe(32_000)
  })

  it('Auto on a reasoning model sends no effort but still the reasoning-model token parameter', async () => {
    const body = await sent('gpt-5-mini', { maxTokens: 800, temperature: 0.2, effortPlan: planOf('openai', 'gpt-5-mini', 'auto') })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body.max_completion_tokens).toBe(800)
    expect(body).not.toHaveProperty('temperature')
  })

  // Negative
  it('gpt-4o gets no reasoning_effort and keeps max_tokens and temperature', async () => {
    const body = await sent('gpt-4o', { maxTokens: 500, temperature: 0.3, effortPlan: planOf('openai', 'gpt-4o', 'high') })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.3)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('a vendor-prefixed OpenAI model on an unverified gateway gets nothing', async () => {
    const def = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'vercel-ai-gateway')!
    const provider = createCompatProvider(def, 'test-key')
    const body = await sent('openai/gpt-5.4', { maxTokens: 500, temperature: 0.3, effortPlan: planOf(def.id, 'openai/gpt-5.4', 'high') }, provider)
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.3)
  })

  it('xAI over Chat Completions gets no effort parameter (none is documented on that wire)', async () => {
    const def = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'xai')!
    const provider = createCompatProvider(def, 'test-key')
    const body = await sent('grok-4.7', { effortPlan: planOf('xai', 'grok-4.7', 'high') }, provider)
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
  })

  // R1B-03 — reasoning models the SDK lists that had no row. An internal
  // caller (memory capture, titles) sets maxTokens + temperature and asks for
  // Auto: a reasoning model must still get max_completion_tokens and no
  // temperature, or OpenAI rejects the call.
  it('GPT-5.2 and a dated GPT-5.4 mini snapshot: an internal Auto call gets the reasoning-model token parameter and no temperature', async () => {
    for (const model of ['gpt-5.2', 'gpt-5.2-2025-12-11', 'gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano']) {
      wire.bodies.length = 0
      const body = await sent(model, { maxTokens: 2000, temperature: 0.2, effortPlan: planOf('openai', model, 'auto') })
      expect(body.max_completion_tokens, model).toBe(2000)
      expect(body, model).not.toHaveProperty('max_tokens')
      expect(body, model).not.toHaveProperty('temperature')
      expect(body, model).not.toHaveProperty('reasoning_effort')
    }
  })

  it("GPT-5.2 'xhigh' and 'none' reach the wire; 'max' clamps to xhigh", async () => {
    expect((await sent('gpt-5.2', { effortPlan: planOf('openai', 'gpt-5.2', 'xhigh') })).reasoning_effort).toBe('xhigh')
    wire.bodies.length = 0
    expect((await sent('gpt-5.2', { effortPlan: planOf('openai', 'gpt-5.2', 'none') })).reasoning_effort).toBe('none')
    wire.bodies.length = 0
    expect((await sent('gpt-5.2', { effortPlan: planOf('openai', 'gpt-5.2', 'max') })).reasoning_effort).toBe('xhigh')
  })

  it("xAI grok-3-mini gets reasoning_effort on the xAI wire, clamped to its low | high ('max' → high)", async () => {
    const def = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'xai')!
    const provider = createCompatProvider(def, 'test-key')
    const body = await sent('grok-3-mini', { maxTokens: 800, temperature: 0.2, effortPlan: planOf('xai', 'grok-3-mini', 'max') }, provider)
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(800)
    expect(body).not.toHaveProperty('temperature')
  })

  it('a Responses-only OpenAI model (gpt-5.2-pro) has no verified control on Chat Completions: nothing is sent (negative)', async () => {
    const body = await sent('gpt-5.2-pro', { maxTokens: 500, temperature: 0.3, effortPlan: planOf('openai', 'gpt-5.2-pro', 'high') })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body.max_tokens).toBe(500)
  })

  it('a request without a plan (a caller bypassing the gateway) sends no reasoning parameter', async () => {
    const body = await sent('o3-mini', { maxTokens: 500, temperature: 0.3 })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.3)
  })

  it('the openai dialect never sends an OpenRouter reasoning object or a Kimi thinking switch', async () => {
    const body = await sent('gpt-5.4', { effortPlan: planOf('openai', 'gpt-5.4', 'high') })
    expect(body.reasoning_effort).toBe('high')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('thinking')
  })
})
