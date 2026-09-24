// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every API provider's normalized stream passes the G1 stream contract (G4):
// each recorded backend stream is fed through the real provider code and the
// result is checked by the harness. A tool row opens with tool_use_start and
// is never settled by the provider (no pre-execution tool_use_end): it
// settles on the runner's tool_result after the call ran.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertStreamContract } from './harness.js'
import type { ApiStreamFixture } from './fixtures/types.js'
import { anthropicRefusalTurn, anthropicToolTurn } from './fixtures/anthropic.js'
import { openaiFilteredTurnWithoutUsage, openaiToolTurn } from './fixtures/openai.js'
import { geminiSafetyTurn, geminiToolTurn } from './fixtures/gemini.js'
import { ollamaToolTurn, ollamaTruncatedTurnWithoutUsage } from './fixtures/ollama.js'
import type { AIProvider, ModelResponse, StreamEvent } from '@modules/model/types.js'
import { anthropicWireStub, sseResponse } from '../../../helpers/anthropic-wire.js'

// The OpenAI and Gemini SDKs are replaced by scripted streams; the Anthropic
// SDK runs for real against a stubbed fetch; Ollama is plain fetch.
const { openaiCreate, geminiStream } = vi.hoisted(() => ({ openaiCreate: vi.fn(), geminiStream: vi.fn() }))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: openaiCreate } }
    models = { list: vi.fn() }
    embeddings = { create: vi.fn() }
    constructor(_opts: unknown) {}
  },
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: vi.fn(), generateContentStream: geminiStream, list: vi.fn() }
    constructor(_opts: unknown) {}
  },
}))

import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createLMStudioProvider } from '@modules/model/submodules/lmstudio/provider'
import { createGeminiProvider } from '@modules/model/submodules/gemini/provider'
import { createOllamaAdapter } from '@modules/model/submodules/ollama/adapter'

afterEach(() => {
  vi.unstubAllGlobals()
  openaiCreate.mockReset()
  geminiStream.mockReset()
})

function scripted<T>(chunks: T[]): AsyncIterable<T> {
  return (async function* () { for (const c of chunks) yield c })()
}

function ndjson(lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 })
}

interface Case {
  fixture: ApiStreamFixture<any>
  /** Arms the backend with the fixture and returns the provider under test. */
  provider: (fixture: ApiStreamFixture<any>) => Pick<AIProvider, 'stream'>
}

const CASES: Case[] = [
  ...[anthropicToolTurn, anthropicRefusalTurn].flatMap((fixture): Case[] => [
    {
      fixture,
      provider: (f) => {
        vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(f.chunks)]).fetch)
        return createAnthropicProvider('key')
      },
    },
    {
      fixture: { ...fixture, name: fixture.name.replace('anthropic', 'anthropic-compat') },
      provider: (f) => {
        vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(f.chunks)]).fetch)
        return createAnthropicCompatProvider(ANTHROPIC_COMPAT_CATALOG[0]!, 'key')
      },
    },
  ]),
  ...[openaiToolTurn, openaiFilteredTurnWithoutUsage].flatMap((fixture): Case[] => [
    { fixture, provider: (f) => { openaiCreate.mockResolvedValueOnce(scripted(f.chunks)); return createOpenAIProvider({ apiKey: 'x' }) } },
    {
      fixture: { ...fixture, name: fixture.name.replace('openai', 'lmstudio') },
      provider: (f) => { openaiCreate.mockResolvedValueOnce(scripted(f.chunks)); return createLMStudioProvider() },
    },
  ]),
  ...[geminiToolTurn, geminiSafetyTurn].map((fixture): Case => ({
    fixture,
    provider: (f) => { geminiStream.mockResolvedValueOnce(scripted(f.chunks)); return createGeminiProvider('k') },
  })),
  ...[ollamaToolTurn, ollamaTruncatedTurnWithoutUsage].map((fixture): Case => ({
    fixture,
    provider: (f) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjson(f.chunks)))
      return createOllamaAdapter('http://localhost:11434')
    },
  })),
]

async function drain(provider: Pick<AIProvider, 'stream'>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const e of provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })) events.push(e)
  return events
}

describe.each(CASES.map((c) => [c.fixture.name, c] as const))('API stream contract — %s', (_name, { fixture, provider }) => {
  it('passes the stream-contract harness', async () => {
    const events = await drain(provider(fixture))
    expect(() => assertStreamContract(events)).not.toThrow()
  })

  it('opens each tool row once and never settles it before the call ran (no tool_use_end)', async () => {
    const events = await drain(provider(fixture))
    const starts = events.filter((e): e is Extract<StreamEvent, { type: 'tool_use_start' }> => e.type === 'tool_use_start')
    expect(starts).toHaveLength(fixture.expected.toolCalls)
    if (fixture.expected.toolUseIds) expect(starts.map((s) => s.id)).toEqual(fixture.expected.toolUseIds)
    expect(events.some((e) => (e as { type: string }).type === 'tool_use_end')).toBe(false)
    // Every opened row is a call in the final content, under the same id.
    const response = (events.find((e) => e.type === 'done') as { response: ModelResponse }).response
    const callIds = response.content.filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id)
    expect(callIds).toEqual(starts.map((s) => s.id))
  })

  it('ends with the normalized stop reason and canonical usage', async () => {
    const events = await drain(provider(fixture))
    const response = (events.find((e) => e.type === 'done') as { response: ModelResponse }).response
    expect(response.stopReason).toBe(fixture.expected.stopReason)
    expect(response.usage).toEqual(fixture.expected.usage)
  })
})
