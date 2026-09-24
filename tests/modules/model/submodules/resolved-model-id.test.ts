// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 (EMP-8) — every API provider reports two things: `model`, the EYAS id it
// was asked for (stable for pricing and labels), and `resolvedModelId`, the
// concrete model the backend says answered. A backend that names no model
// yields no resolvedModelId — never a guess. Discovery (fetchModels) fails
// loudly instead of passing a static list off as what the backend offers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ModelResponse, StreamEvent } from '@modules/model/types'

const h = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
  openaiList: vi.fn(),
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  geminiList: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: h.anthropicCreate }
    baseURL = 'https://example.test'
    constructor(_opts: unknown) {}
  },
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: h.openaiCreate } }
    models = { list: h.openaiList }
    embeddings = { create: vi.fn() }
    baseURL = 'https://example.test/v1'
    constructor(_opts: unknown) {}
  },
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: h.generateContent, generateContentStream: h.generateContentStream, list: h.geminiList }
    constructor(_opts: unknown) {}
  },
}))

import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createGeminiProvider } from '@modules/model/submodules/gemini/provider'
import { createOllamaAdapter } from '@modules/model/submodules/ollama/adapter'
import { createOpenRouterProvider } from '@modules/model/submodules/openrouter/provider'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'

const ask = (model: string) => ({ model, messages: [{ role: 'user' as const, content: 'hi' }] })

async function done(stream: AsyncIterable<StreamEvent>): Promise<ModelResponse> {
  let response: ModelResponse | undefined
  for await (const e of stream) if (e.type === 'done') response = e.response
  return response!
}

function iter(...items: unknown[]) {
  return (async function* () { for (const item of items) yield item })()
}

const anthropicMessage = (model?: string) => ({
  id: 'msg-1', ...(model ? { model } : {}), content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
})

const anthropicStream = (model?: string) => iter(
  { type: 'message_start', message: { id: 'msg-1', ...(model ? { model } : {}), usage: { input_tokens: 1 } } },
  { type: 'content_block_start', content_block: { type: 'text' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop' },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
)

beforeEach(() => { for (const fn of Object.values(h)) fn.mockReset() })

describe('Anthropic API and Anthropic-compatible endpoints', () => {
  const compat = () => createAnthropicCompatProvider(ANTHROPIC_COMPAT_CATALOG[0], 'key')

  it('model stays the requested id; resolvedModelId is what the API reported (positive)', async () => {
    h.anthropicCreate.mockResolvedValueOnce(anthropicMessage('claude-sonnet-4-6-20260101'))
    expect(await createAnthropicProvider('k').complete(ask('claude-sonnet-4-6'))).toMatchObject({ model: 'claude-sonnet-4-6', resolvedModelId: 'claude-sonnet-4-6-20260101' })
    h.anthropicCreate.mockResolvedValueOnce(anthropicStream('claude-sonnet-4-6-20260101'))
    expect(await done(createAnthropicProvider('k').stream(ask('claude-sonnet-4-6')))).toMatchObject({ model: 'claude-sonnet-4-6', resolvedModelId: 'claude-sonnet-4-6-20260101' })

    h.anthropicCreate.mockResolvedValueOnce(anthropicMessage('MiniMax-M2.5-real'))
    const out = await compat().complete(ask('MiniMax-M2.5'))
    expect(out).toMatchObject({ provider: ANTHROPIC_COMPAT_CATALOG[0].id, model: 'MiniMax-M2.5', resolvedModelId: 'MiniMax-M2.5-real' })
    h.anthropicCreate.mockResolvedValueOnce(anthropicStream('MiniMax-M2.5-real'))
    expect(await done(compat().stream(ask('MiniMax-M2.5')))).toMatchObject({ model: 'MiniMax-M2.5', resolvedModelId: 'MiniMax-M2.5-real' })
  })

  it('a response naming no model carries no resolvedModelId (negative)', async () => {
    h.anthropicCreate.mockResolvedValueOnce(anthropicMessage())
    const out = await createAnthropicProvider('k').complete(ask('claude-sonnet-4-6'))
    expect(out.model).toBe('claude-sonnet-4-6')
    expect(out).not.toHaveProperty('resolvedModelId')
    h.anthropicCreate.mockResolvedValueOnce(anthropicStream())
    expect(await done(compat().stream(ask('MiniMax-M2.5')))).not.toHaveProperty('resolvedModelId')
  })
})

describe('OpenAI-shaped providers (OpenAI, compat endpoints, Kimi, OpenRouter, LM Studio)', () => {
  it('model stays the requested id; the backend model field is resolvedModelId (positive)', async () => {
    h.openaiCreate.mockResolvedValueOnce({
      id: 'c1', model: 'anthropic/claude-sonnet-4.6',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(await createOpenAIProvider({ apiKey: 'x', providerId: 'openrouter' }).complete(ask('openrouter/auto'))).toMatchObject({ model: 'openrouter/auto', resolvedModelId: 'anthropic/claude-sonnet-4.6' })

    h.openaiCreate.mockResolvedValueOnce(iter(
      { id: 'c1', model: 'gpt-5.2-2026-08-01', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ))
    expect(await done(createOpenAIProvider({ apiKey: 'x' }).stream(ask('gpt-5.2')))).toMatchObject({ model: 'gpt-5.2', resolvedModelId: 'gpt-5.2-2026-08-01' })
  })

  it('a stream whose chunks name no model carries no resolvedModelId (negative)', async () => {
    h.openaiCreate.mockResolvedValueOnce(iter({ id: 'c1', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }))
    const out = await done(createOpenAIProvider({ apiKey: 'x' }).stream(ask('gpt-5.2')))
    expect(out.model).toBe('gpt-5.2')
    expect(out).not.toHaveProperty('resolvedModelId')
  })

  it('OpenAI discovery returns what the API listed — even nothing — never the static list (negative)', async () => {
    h.openaiList.mockResolvedValueOnce(iter({ id: 'text-embedding-3-small' }))
    expect(await createOpenAIProvider({ apiKey: 'x' }).fetchModels!()).toEqual([])
    h.openaiList.mockRejectedValueOnce(new Error('401'))
    await expect(createOpenAIProvider({ apiKey: 'x' }).fetchModels!()).rejects.toThrow('401')
  })
})

describe('Gemini', () => {
  it('model stays the requested id; modelVersion is resolvedModelId (positive)', async () => {
    h.generateContent.mockResolvedValueOnce({ responseId: 'r', modelVersion: 'gemini-3-pro-preview-09', candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })
    expect(await createGeminiProvider('k').complete(ask('gemini-3-pro'))).toMatchObject({ model: 'gemini-3-pro', resolvedModelId: 'gemini-3-pro-preview-09' })
    h.generateContentStream.mockResolvedValueOnce(iter({ responseId: 'r', modelVersion: 'gemini-3-pro-preview-09', candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }))
    expect(await done(createGeminiProvider('k').stream(ask('gemini-3-pro')))).toMatchObject({ model: 'gemini-3-pro', resolvedModelId: 'gemini-3-pro-preview-09' })
  })

  it('no modelVersion: the requested id, never an empty model, and no resolvedModelId (negative)', async () => {
    h.generateContent.mockResolvedValueOnce({ responseId: 'r', candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })
    const out = await createGeminiProvider('k').complete(ask('gemini-3-pro'))
    expect(out.model).toBe('gemini-3-pro')
    expect(out).not.toHaveProperty('resolvedModelId')
  })

  it('discovery returns what the API listed, never the static list (negative)', async () => {
    h.geminiList.mockResolvedValueOnce(iter({ name: 'models/embedding-001', supportedActions: ['embedContent'] }))
    expect(await createGeminiProvider('k').fetchModels!()).toEqual([])
  })
})

describe('fetch-based backends', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const respond = (body: unknown, status = 200) => { globalThis.fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as any }

  it('Ollama reports the model it ran as resolvedModelId (positive) and nothing when it names none (negative)', async () => {
    respond({ model: 'llama3.2:latest', message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop' })
    expect(await createOllamaAdapter('http://127.0.0.1:11434').complete(ask('llama3.2'))).toMatchObject({ model: 'llama3.2', resolvedModelId: 'llama3.2:latest' })

    respond(`${JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })}\n`)
    const out = await done(createOllamaAdapter('http://127.0.0.1:11434').stream(ask('llama3.2')))
    expect(out.model).toBe('llama3.2')
    expect(out).not.toHaveProperty('resolvedModelId')
  })

  it('OpenRouter, Kimi and compat discovery throw on a failed listing instead of answering with the static list (negative)', async () => {
    respond({ error: 'unauthorized' }, 401)
    await expect(createOpenRouterProvider('k').fetchModels!()).rejects.toThrow(/401/)
    await expect(createKimiProvider('k').fetchModels!()).rejects.toThrow(/401/)
    await expect(createCompatProvider(OPENAI_COMPAT_CATALOG[0], 'k').fetchModels!()).rejects.toThrow(/401/)
  })

  it('a successful compat listing is taken as is (positive)', async () => {
    respond({ data: [{ id: 'grok-4.7' }] })
    expect((await createCompatProvider(OPENAI_COMPAT_CATALOG[0], 'k').fetchModels!()).map((m) => m.id)).toEqual(['grok-4.7'])
    respond({ data: [{ id: 'kimi-k3' }, { id: 'kimi-k9-new' }, { id: 'whisper' }] })
    expect((await createKimiProvider('k').fetchModels!()).map((m) => m.id)).toEqual(['kimi-k3', 'kimi-k9-new'])
  })
})
