// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Ollama thinking (F9): /api/show discovery → model_config.metadata.reasoning
// → the capability registry (bundled overlay) → the gateway's effort plan →
// the `think` field on /api/chat. Nothing is ever guessed: a model without
// the 'thinking' capability, or one whose /api/show failed, never gets a
// `think` key (Ollama rejects a truthy one with HTTP 400).

import { describe, it, expect, vi, afterEach } from 'vitest'
import showFixture from '../../../fixtures/ollama/api-show.json'
import {
  createOllamaAdapter,
  ollamaReasoningFromShow,
  ollamaThink,
  OllamaShowSchema,
} from '@modules/model/submodules/ollama/adapter'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { resolveEffortPlan, type EffortPlan } from '@modules/model/reasoning/resolve'
import type { EffortSetting } from '@modules/model/reasoning/ladder'
import { parseModelConfigMetadata } from '@modules/model/provider-config-service'
import type { ModelRequest } from '@modules/model/types'

const AT = '2026-09-23T10:00:00.000Z'
const BASE = 'http://localhost:11434'
const responses = showFixture.responses as Record<string, unknown>

function show(key: string) {
  return OllamaShowSchema.parse(responses[key])
}

/** The plan the gateway would resolve for `level` on `model`, given what discovery stored. */
function planFor(level: EffortSetting, model: string, discovered: unknown): EffortPlan {
  const registry = createReasoningRegistry({ getDiscovered: () => discovered })
  return resolveEffortPlan({
    intent: { level, source: 'request' },
    capability: registry.get('ollama', model),
    maxOutputTokens: 8192,
    streaming: true,
  }).plan
}

/** The /api/chat body complete() sends for `request`. */
async function chatBody(request: ModelRequest): Promise<Record<string, any>> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ model: request.model, message: { role: 'assistant', content: 'ok' }, done: true }),
  })
  globalThis.fetch = fetchMock as any
  await createOllamaAdapter(BASE).complete(request)
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

const ask = (model: string, effortPlan?: EffortPlan, extra: Partial<ModelRequest> = {}): ModelRequest => ({
  model,
  messages: [{ role: 'user', content: 'hi' }],
  ...(effortPlan ? { effortPlan } : {}),
  ...extra,
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('ollamaReasoningFromShow (discovery)', () => {
  it('(+) named thinking values → an effort ladder with the reported default (gpt-oss)', () => {
    expect(ollamaReasoningFromShow(show('gpt-oss:20b'), AT)).toEqual({
      source: 'models-api', param: 'effort', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', discoveredAt: AT,
    })
  })

  it('(+) on/off thinking values → a toggle, on by default (qwen3)', () => {
    expect(ollamaReasoningFromShow(show('qwen3:8b'), AT)).toEqual({
      source: 'models-api', param: 'toggle', levels: ['none', 'high'], defaultLevel: 'high', discoveredAt: AT,
    })
  })

  it("(+) a server that reports only the 'thinking' capability → the documented on/off toggle", () => {
    expect(ollamaReasoningFromShow(show('qwen3:8b@legacy-server'), AT)).toMatchObject({ param: 'toggle', levels: ['none', 'high'], defaultLevel: 'high' })
  })

  it("(+) named levels plus false → 'none' joins the ladder", () => {
    const r = ollamaReasoningFromShow({ capabilities: ['thinking'], thinking: { values: [false, 'low', 'high', 'max'], default: false } }, AT)
    expect(r).toMatchObject({ param: 'effort', levels: ['none', 'low', 'high', 'max'], defaultLevel: 'none' })
  })

  it("(−) no 'thinking' capability → no control at all (param none)", () => {
    expect(ollamaReasoningFromShow(show('llama3.2:latest'), AT)).toEqual({ source: 'models-api', param: 'none', levels: [], discoveredAt: AT })
    expect(ollamaReasoningFromShow(show('llava:13b'), AT)?.param).toBe('none')
  })

  it('(−) no capabilities list, or no answer at all → nothing discovered (null)', () => {
    expect(ollamaReasoningFromShow(show('old-server-model'), AT)).toBeNull()
    expect(ollamaReasoningFromShow(undefined, AT)).toBeNull()
  })

  it('(−) only names EYAS has no rung for → nothing discovered', () => {
    expect(ollamaReasoningFromShow({ capabilities: ['thinking'], thinking: { values: ['turbo'] } }, AT)).toBeNull()
  })

  it('every discovered record is storable as model_config.metadata.reasoning', () => {
    for (const key of Object.keys(responses)) {
      const reasoning = ollamaReasoningFromShow(show(key), AT)
      if (!reasoning) continue
      expect(parseModelConfigMetadata({ reasoning })?.reasoning, key).toEqual(reasoning)
    }
  })
})

describe('the think field on /api/chat', () => {
  const gptOss = ollamaReasoningFromShow(show('gpt-oss:20b'), AT)
  const gptOssLegacy = ollamaReasoningFromShow(show('gpt-oss:20b@legacy-server'), AT)
  const qwen3 = ollamaReasoningFromShow(show('qwen3:8b'), AT)
  const llama = ollamaReasoningFromShow(show('llama3.2:latest'), AT)

  it("(+) gpt-oss 'high' sends think 'high' (a level, never a boolean)", async () => {
    expect((await chatBody(ask('gpt-oss:20b', planFor('high', 'gpt-oss:20b', gptOss)))).think).toBe('high')
    expect((await chatBody(ask('gpt-oss:20b', planFor('low', 'gpt-oss:20b', gptOss)))).think).toBe('low')
  })

  it("(+) gpt-oss on a server without thinking values still takes levels (the overlay's server clamp wins over generic on/off)", async () => {
    expect((await chatBody(ask('gpt-oss:20b', planFor('medium', 'gpt-oss:20b', gptOssLegacy)))).think).toBe('medium')
    // gpt-oss cannot be switched off: 'none' clamps to its lowest level, never false.
    expect((await chatBody(ask('gpt-oss:20b', planFor('none', 'gpt-oss:20b', gptOssLegacy)))).think).toBe('low')
  })

  it("(+) qwen3 'none' sends think false; any rung switches it on with true", async () => {
    expect((await chatBody(ask('qwen3:8b', planFor('none', 'qwen3:8b', qwen3)))).think).toBe(false)
    expect((await chatBody(ask('qwen3:8b', planFor('high', 'qwen3:8b', qwen3)))).think).toBe(true)
    expect((await chatBody(ask('qwen3:8b', planFor('low', 'qwen3:8b', qwen3)))).think).toBe(true)
  })

  it("(−) 'auto' sends no think key (the model's own default)", async () => {
    expect(await chatBody(ask('qwen3:8b', planFor('auto', 'qwen3:8b', qwen3)))).not.toHaveProperty('think')
    expect(await chatBody(ask('gpt-oss:20b', planFor('auto', 'gpt-oss:20b', gptOss)))).not.toHaveProperty('think')
  })

  it('(−) a model without the thinking capability never gets a think key, whatever the level', async () => {
    for (const level of ['none', 'low', 'high', 'max'] as const) {
      expect(await chatBody(ask('llama3.2:latest', planFor(level, 'llama3.2:latest', llama))), level).not.toHaveProperty('think')
    }
  })

  it('(−) an /api/show failure leaves the model unknown and nothing is sent', async () => {
    const failed = ollamaReasoningFromShow(undefined, AT)
    for (const level of ['none', 'high'] as const) {
      expect(await chatBody(ask('qwen3:8b', planFor(level, 'qwen3:8b', failed))), level).not.toHaveProperty('think')
    }
  })

  it('(−) a request without a plan (no gateway in between) sends no think key', async () => {
    expect(await chatBody(ask('qwen3:8b'))).not.toHaveProperty('think')
    expect(ollamaThink(undefined)).toBeUndefined()
  })

  it('(+) an explicit level raises a smaller num_predict to what the level needs; (−) auto keeps it', async () => {
    const high = await chatBody(ask('gpt-oss:20b', planFor('high', 'gpt-oss:20b', gptOss), { maxTokens: 1024 }))
    expect(high.options.num_predict).toBe(8192)
    const auto = await chatBody(ask('gpt-oss:20b', planFor('auto', 'gpt-oss:20b', gptOss), { maxTokens: 1024 }))
    expect(auto.options.num_predict).toBe(1024)
    const off = await chatBody(ask('qwen3:8b', planFor('none', 'qwen3:8b', qwen3), { maxTokens: 1024 }))
    expect(off.options.num_predict).toBe(1024)
  })
})

describe('streamed thinking', () => {
  function ndjson(lines: unknown[]) {
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    return { ok: true, body: new Response(body).body }
  }

  it('(+) message.thinking becomes thinking events, never answer text or done content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ndjson([
      { model: 'qwen3:8b', message: { role: 'assistant', content: '', thinking: 'Count the r' }, done: false },
      { model: 'qwen3:8b', message: { role: 'assistant', content: '', thinking: "'s: three." }, done: false },
      { model: 'qwen3:8b', message: { role: 'assistant', content: 'Three.' }, done: false },
      { model: 'qwen3:8b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 9 },
    ])) as any
    const events: any[] = []
    for await (const e of createOllamaAdapter(BASE).stream(ask('qwen3:8b'))) events.push(e)

    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text)).toEqual(['Count the r', "'s: three."])
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Three.')
    const done = events.find((e) => e.type === 'done')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Three.' }])
    // The thinking events come before the answer.
    expect(events.findIndex((e) => e.type === 'thinking')).toBeLessThan(events.findIndex((e) => e.type === 'text'))
  })

  it('(−) a non-thinking reply yields no thinking event', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ndjson([
      { model: 'llama3.2', message: { role: 'assistant', content: 'Hi' }, done: false },
      { model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ])) as any
    const events: any[] = []
    for await (const e of createOllamaAdapter(BASE).stream(ask('llama3.2'))) events.push(e)
    expect(events.some((e) => e.type === 'thinking')).toBe(false)
  })

  it('(+) complete() keeps message.thinking out of the answer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'qwen3:8b', message: { role: 'assistant', content: 'Three.', thinking: 'Count…' }, done: true }),
    }) as any
    const response = await createOllamaAdapter(BASE).complete(ask('qwen3:8b'))
    expect(response.content).toEqual([{ type: 'text', text: 'Three.' }])
  })
})

describe('fetchModelsWithCapabilities', () => {
  it('(+) records each model\'s discovered thinking control in metadata.reasoning', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return { ok: true, json: async () => ({ models: ['gpt-oss:20b', 'qwen3:8b', 'llama3.2:latest', 'old-server-model'].map((name) => ({ name, size: 1, details: {} })) }) }
      }
      const model = JSON.parse(String(init?.body)).model as string
      return { ok: true, json: async () => responses[model] }
    }) as any
    const models = await createOllamaAdapter(BASE).fetchModelsWithCapabilities()
    const reasoning = (id: string) => (models.find((m) => m.id === id)?.metadata as any)?.reasoning
    expect(reasoning('gpt-oss:20b')).toMatchObject({ param: 'effort', levels: ['low', 'medium', 'high'] })
    expect(reasoning('qwen3:8b')).toMatchObject({ param: 'toggle', levels: ['none', 'high'] })
    expect(reasoning('llama3.2:latest')).toMatchObject({ param: 'none', levels: [] })
    // (−) an answer without capabilities proves nothing: no reasoning facts, tools kept.
    expect(reasoning('old-server-model')).toBeUndefined()
    expect(models.find((m) => m.id === 'old-server-model')?.supportsTools).toBe(true)
    for (const m of models) expect(parseModelConfigMetadata(m.metadata), m.id).not.toBeNull()
  })

  it('(−) an /api/show that fails leaves that model without reasoning facts', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3:8b', size: 1, details: {} }] }) }
      throw new Error('ECONNRESET')
    }) as any
    const [model] = await createOllamaAdapter(BASE).fetchModelsWithCapabilities()
    expect((model.metadata as any)?.reasoning).toBeUndefined()
  })

  it('(−) an unreachable server fails the discovery (the stored rows stand)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as any
    await expect(createOllamaAdapter(BASE).fetchModelsWithCapabilities()).rejects.toThrow(/api\/tags/)
  })
})
