// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F8: Gemini reasoning on the generateContent wire — thinkingLevel for the
// Gemini 3 family, a thinking budget for 2.5, thought summaries as thinking
// events — driven only by the gateway's effort plan, which is resolved here
// through the real registry (bundled overlay) and resolver.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelRequest, ModelResponse, StreamEvent, ToolUseBlock } from '@modules/model/types'
import type { ReasoningCapability } from '@modules/model/reasoning/capability'
import type { EffortSetting } from '@modules/model/reasoning/ladder'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { effortPlanFor } from '../../helpers/effort-plan.js'

const { generateContent, generateContentStream, list } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent, generateContentStream, list }
    constructor(_opts: unknown) {}
  },
}))

// Import AFTER the mock is registered.
import { createGeminiProvider, geminiModelFromApi, reasoningFromGeminiModel, GEMINI_MODELS } from '@modules/model/submodules/gemini/provider'
import { buildGeminiThinkingConfig, applyGeminiReasoning, fromGeminiResponse } from '@modules/model/submodules/gemini/adapter'

const OUTPUT_CAP = 65_536
const DISCOVERED_AT = '2026-09-23T10:00:00.000Z'

const registry = createReasoningRegistry({ getDiscovered: () => null })

function capabilityOf(model: string): ReasoningCapability {
  return registry.get('gemini', model)
}

function planFor(model: string, level: EffortSetting, streaming = true) {
  return effortPlanFor(level, capabilityOf(model), { maxOutputTokens: OUTPUT_CAP, streaming })
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'think about it' }], ...overrides }
}

function chunks(...items: unknown[]) {
  return (async function* () { for (const item of items) yield item })()
}

async function drain(stream: AsyncIterable<StreamEvent>) {
  const events: StreamEvent[] = []
  for await (const e of stream) events.push(e)
  const done = events.find((e) => e.type === 'done') as { type: 'done'; response: ModelResponse }
  return { events, response: done.response }
}

/** The generateContentStream config of the n-th call. */
function sentConfig(n = 0): Record<string, any> {
  return generateContentStream.mock.calls[n][0].config
}

async function streamWith(req: ModelRequest) {
  generateContentStream.mockResolvedValueOnce(chunks({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }))
  await drain(createGeminiProvider('k').stream(req))
  return sentConfig(generateContentStream.mock.calls.length - 1)
}

beforeEach(() => {
  generateContent.mockReset()
  generateContentStream.mockReset()
  list.mockReset()
})

// ─── Gemini 3: thinkingLevel ────────────────────────────────────────────────

describe('Gemini 3 — thinkingLevel from the plan', () => {
  it.each([
    ['gemini-3.8-flash', 'low', 'LOW'],
    ['gemini-3.5-flash', 'minimal', 'MINIMAL'],
    ['gemini-3.6-flash', 'medium', 'MEDIUM'],
    ['gemini-3.1-pro-preview', 'high', 'HIGH'],
    ['gemini-3-flash-preview', 'high', 'HIGH'],
  ] as const)('%s at %s sends thinkingLevel %s with thought summaries (positive)', async (model, level, wire) => {
    const config = await streamWith(request({ model, effortPlan: planFor(model, level) }))
    expect(config.thinkingConfig).toEqual({ thinkingLevel: wire, includeThoughts: true })
    expect(config.thinkingConfig).not.toHaveProperty('thinkingBudget')
  })

  it('a rung the model lacks arrives clamped by the resolver: minimal → LOW on 3.8 Flash, xhigh → HIGH on 3.1 Pro (positive)', async () => {
    expect((await streamWith(request({ effortPlan: planFor('gemini-3.8-flash', 'minimal') }))).thinkingConfig.thinkingLevel).toBe('LOW')
    const pro = await streamWith(request({ model: 'gemini-3.1-pro-preview', effortPlan: planFor('gemini-3.1-pro-preview', 'xhigh') }))
    expect(pro.thinkingConfig.thinkingLevel).toBe('HIGH')
  })

  it("'none' on an always-on Gemini 3 model never switches thinking off: it runs at the lowest level (negative)", async () => {
    const config = await streamWith(request({ model: 'gemini-3.1-pro-preview', effortPlan: planFor('gemini-3.1-pro-preview', 'none') }))
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW', includeThoughts: true })
  })

  it("'auto' sends neither a level nor a budget — only the summaries of a model that thinks unasked (negative)", async () => {
    const config = await streamWith(request({ effortPlan: planFor('gemini-3.8-flash', 'auto') }))
    expect(config.thinkingConfig).toEqual({ includeThoughts: true })
  })

  it('raises a lower caller cap to what the level needs, and leaves an unset cap to the model (positive)', async () => {
    const plan = planFor('gemini-3.8-flash', 'high')
    expect(plan.maxTokensFloor).toBe(32_000)
    expect((await streamWith(request({ maxTokens: 2000, effortPlan: plan }))).maxOutputTokens).toBe(32_000)
    expect((await streamWith(request({ effortPlan: plan }))).maxOutputTokens).toBeUndefined()
    // A higher caller cap is kept.
    expect((await streamWith(request({ maxTokens: 60_000, effortPlan: plan }))).maxOutputTokens).toBe(60_000)
  })

  it("never raises the cap for 'auto' (negative)", async () => {
    const config = await streamWith(request({ maxTokens: 2000, effortPlan: planFor('gemini-3.8-flash', 'auto') }))
    expect(config.maxOutputTokens).toBe(2000)
  })
})

// ─── Gemini 2.5: thinkingBudget ─────────────────────────────────────────────

describe('Gemini 2.5 — thinkingBudget from the plan', () => {
  it("2.5 Flash 'none' sends thinkingBudget 0 and no summaries (positive)", () => {
    expect(buildGeminiThinkingConfig(planFor('gemini-2.5-flash', 'none'))).toEqual({ thinkingBudget: 0 })
  })

  it("2.5 Pro 'high' sends a budget within [128, 32768] with summaries (positive)", () => {
    const config = buildGeminiThinkingConfig(planFor('gemini-2.5-pro', 'high'))!
    expect(config.includeThoughts).toBe(true)
    expect(config.thinkingBudget).toBeGreaterThanOrEqual(128)
    expect(config.thinkingBudget).toBeLessThanOrEqual(32_768)
    expect(config).not.toHaveProperty('thinkingLevel')
  })

  it('budgets rise with the level and stay inside the model range, also for a non-streaming call (positive)', () => {
    for (const streaming of [true, false]) {
      const budgets = (['minimal', 'low', 'medium', 'high', 'max'] as const)
        .map((level) => buildGeminiThinkingConfig(planFor('gemini-2.5-flash', level, streaming))!.thinkingBudget!)
      for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1])
      for (const b of budgets) {
        expect(b).toBeGreaterThan(0)
        expect(b).toBeLessThanOrEqual(24_576)
      }
    }
    const lite = buildGeminiThinkingConfig(planFor('gemini-2.5-flash-lite', 'minimal'))!
    expect(lite.thinkingBudget).toBeGreaterThanOrEqual(512)
  })

  it('raises a lower caller cap above the budget (positive)', async () => {
    const plan = planFor('gemini-2.5-pro', 'high')
    const config = await streamWith(request({ model: 'gemini-2.5-pro', maxTokens: 1000, effortPlan: plan }))
    expect(config.maxOutputTokens).toBeGreaterThan(config.thinkingConfig.thinkingBudget)
    expect(config.maxOutputTokens).toBeLessThanOrEqual(OUTPUT_CAP)
  })

  it("2.5 Pro 'none' never gets budget 0: it cannot be switched off (negative)", () => {
    const config = buildGeminiThinkingConfig(planFor('gemini-2.5-pro', 'none'))!
    expect(config.thinkingBudget).toBeGreaterThanOrEqual(128)
  })

  it("'auto' sends no budget; a default-off model (2.5 Flash-Lite) gets no thinkingConfig at all (negative)", () => {
    expect(buildGeminiThinkingConfig(planFor('gemini-2.5-pro', 'auto'))).toEqual({ includeThoughts: true })
    expect(buildGeminiThinkingConfig(planFor('gemini-2.5-flash', 'auto'))).toEqual({ includeThoughts: true })
    expect(buildGeminiThinkingConfig(planFor('gemini-2.5-flash-lite', 'auto'))).toBeUndefined()
  })

  it('a degenerate zero budget for a thinking rung never goes out as 0 (which would switch thinking off) (negative)', () => {
    const plan = { ...planFor('gemini-2.5-flash', 'low'), budgetTokens: 0 }
    expect(buildGeminiThinkingConfig(plan)).toEqual({ includeThoughts: true })
  })
})

// ─── Models without reasoning control ──────────────────────────────────────

describe('models without reasoning control', () => {
  it('an unknown / non-thinking model gets no thinkingConfig at any level (negative)', async () => {
    for (const level of ['auto', 'none', 'high', 'max'] as const) {
      const config = await streamWith(request({ model: 'gemini-2.0-flash', effortPlan: planFor('gemini-2.0-flash', level) }))
      expect(config).not.toHaveProperty('thinkingConfig')
    }
  })

  it('a request without a plan (bypassing the gateway) sends nothing and keeps its sampling (negative)', async () => {
    const config = await streamWith(request({ temperature: 0.3, maxTokens: 500 }))
    expect(config).not.toHaveProperty('thinkingConfig')
    expect(config.temperature).toBe(0.3)
    expect(config.maxOutputTokens).toBe(500)
  })

  it('a sampling-locked record drops temperature/topP/topK; an unlocked one keeps them', () => {
    const locked = { ...planFor('gemini-3.8-flash', 'low'), samplingLocked: true }
    const config: Record<string, any> = { temperature: 0.2, topP: 0.9, topK: 40 }
    applyGeminiReasoning(config, locked)
    expect(config).not.toHaveProperty('temperature')
    expect(config).not.toHaveProperty('topP')
    expect(config).not.toHaveProperty('topK')

    const open: Record<string, any> = { temperature: 0.2 }
    applyGeminiReasoning(open, planFor('gemini-3.8-flash', 'low'))
    expect(open.temperature).toBe(0.2)
  })

  it('a discovered "no thinking" (models.list thinking:false) overrides a matching overlay family (negative)', () => {
    const discovered = reasoningFromGeminiModel(false, DISCOVERED_AT)
    const withDiscovery = createReasoningRegistry({ getDiscovered: () => discovered })
    const capability = withDiscovery.get('gemini', 'gemini-2.5-flash-preview-tts')
    expect(capability.kind).toBe('none')
    const plan = effortPlanFor('high', capability, { maxOutputTokens: OUTPUT_CAP })
    expect(plan.level).toBe('auto')
    expect(buildGeminiThinkingConfig(plan)).toBeUndefined()
  })
})

// ─── Thought summaries ─────────────────────────────────────────────────────

describe('thought summaries', () => {
  it('stream: thought parts become thinking events, never answer text or done content (positive + negative)', async () => {
    generateContentStream.mockResolvedValueOnce(chunks(
      { candidates: [{ content: { parts: [{ text: 'Weighing the options', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Answer.' }] } }] },
      { candidates: [{ content: { parts: [{ text: '', thought: true, thoughtSignature: 'U0lH' }] }, finishReason: 'STOP' }] },
    ))
    const { events, response } = await drain(createGeminiProvider('k').stream(request({ effortPlan: planFor('gemini-3.8-flash', 'high') })))

    expect(events.filter((e) => e.type === 'thinking')).toEqual([{ type: 'thinking', text: 'Weighing the options' }])
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')
    expect(text).toBe('Answer.')
    expect(response.content).toEqual([{ type: 'text', text: 'Answer.' }])
    expect(JSON.stringify(response.content)).not.toContain('Weighing')
    expect(response.stopReason).toBe('end')
  })

  it("stream: a call after a thought keeps its thoughtSignature and still ends the turn for tool_use (positive)", async () => {
    generateContentStream.mockResolvedValueOnce(chunks({
      candidates: [{
        content: {
          parts: [
            { text: 'I should search', thought: true },
            { functionCall: { id: 'fc-7', name: 'memory_search', args: { query: 'q' } }, thoughtSignature: 'U0lHLTc=' },
          ],
        },
        finishReason: 'STOP',
      }],
    }))
    const { response } = await drain(createGeminiProvider('k').stream(request()))
    const block = response.content.find((b) => b.type === 'tool_use') as ToolUseBlock
    expect(block).toEqual({ type: 'tool_use', id: 'fc-7', name: 'memory_search', input: { query: 'q' }, signature: 'U0lHLTc=' })
    expect(response.content.map((b) => b.type)).toEqual(['tool_use'])
    expect(response.stopReason).toBe('tool_use')
  })

  it('complete(): thought parts stay out of the content; the answer and the call signature stay (positive + negative)', async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [
            { text: 'private reasoning', thought: true },
            { text: 'The answer' },
            { functionCall: { id: 'fc-1', name: 'memory_search', args: {} }, thoughtSignature: 'U0lH' },
          ],
        },
        finishReason: 'STOP',
      }],
    })
    const response = await createGeminiProvider('k').complete(request({ effortPlan: planFor('gemini-3.8-flash', 'low') }))
    expect(response.content).toEqual([
      { type: 'text', text: 'The answer' },
      { type: 'tool_use', id: 'fc-1', name: 'memory_search', input: {}, signature: 'U0lH' },
    ])
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW', includeThoughts: true })
  })

  it('a part explicitly marked thought:false is answer text (negative)', () => {
    const response = fromGeminiResponse({ candidates: [{ content: { parts: [{ text: 'visible', thought: false }] }, finishReason: 'STOP' }] })
    expect(response.content).toEqual([{ type: 'text', text: 'visible' }])
  })
})

// ─── Discovery and the seed ────────────────────────────────────────────────

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../../fixtures/gemini/models-list.json'), 'utf8')) as {
  models: Array<Record<string, unknown>>
}

function withoutMetadata(rows: Array<{ metadata?: unknown } & Record<string, unknown>>) {
  return rows.map(({ metadata: _m, ...rest }) => rest)
}

describe('models.list discovery', () => {
  it('the built-in seed is exactly the models.list fixture mapped by discovery (positive)', () => {
    const mapped = FIXTURE.models.map((m) => geminiModelFromApi(m, DISCOVERED_AT)).filter((m) => m !== null)
    expect(withoutMetadata(mapped as any)).toEqual(GEMINI_MODELS)
  })

  it('every seeded model has a verified reasoning record; none of them is a shut-down id (positive + negative)', () => {
    for (const model of GEMINI_MODELS) {
      expect(capabilityOf(model.id).source, model.id).toBe('overlay')
      expect(capabilityOf(model.id).kind, model.id).toBe('effort')
    }
    const ids = GEMINI_MODELS.map((m) => m.id)
    for (const gone of ['gemini-2.0-flash', 'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-05-20', 'gemini-3-pro-preview']) {
      expect(ids).not.toContain(gone)
    }
  })

  it('fetchModels maps the listed models, records thinking:false as no control, and skips what cannot chat (positive + negative)', async () => {
    list.mockResolvedValueOnce(chunks(
      ...FIXTURE.models,
      { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', inputTokenLimit: 8192, outputTokenLimit: 16_384, supportedActions: ['generateContent'], thinking: false },
      { name: 'models/gemini-embedding-001', supportedActions: ['embedContent'] },
      { displayName: 'no name', supportedActions: ['generateContent'] },
      { name: 'models/bad-limits', supportedActions: ['generateContent'], inputTokenLimit: 'huge' },
    ))
    const rows = await createGeminiProvider('k').fetchModels!()

    expect(rows.map((r) => r.id)).toEqual([...GEMINI_MODELS.map((m) => m.id), 'gemini-2.5-flash-preview-tts'])
    const flash = rows.find((r) => r.id === 'gemini-3.8-flash')!
    expect(flash).toMatchObject({ contextWindow: 1_048_576, maxOutputTokens: 65_536 })
    // thinking:true adds nothing over the overlay: no guessed ladder is stored.
    expect(flash.metadata).not.toHaveProperty('reasoning')
    expect(typeof flash.metadata?.discoveredAt).toBe('string')
    const tts = rows.find((r) => r.id === 'gemini-2.5-flash-preview-tts')!
    expect(tts.metadata?.reasoning).toMatchObject({ source: 'models-api', param: 'none', levels: [] })
  })

  it('reasoningFromGeminiModel records only a definite "no thinking" (negative)', () => {
    expect(reasoningFromGeminiModel(true, DISCOVERED_AT)).toBeNull()
    expect(reasoningFromGeminiModel(undefined, DISCOVERED_AT)).toBeNull()
    expect(reasoningFromGeminiModel(null, DISCOVERED_AT)).toBeNull()
  })
})
