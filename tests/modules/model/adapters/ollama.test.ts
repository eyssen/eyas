import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createOllamaAdapter,
  toOllamaMessages,
  toOllamaTools,
  fromOllamaResponse,
  OLLAMA_DEFAULT_NUM_CTX,
  ollamaNumCtx,
} from '@modules/model/submodules/ollama/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'
import { classifyModelError } from '@shared/classify-model-error'

describe('Ollama adapter', () => {
  describe('toOllamaMessages', () => {
    it('adds system message at the start', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }]
      const result = toOllamaMessages(messages, 'Be helpful')
      expect(result[0]).toEqual({ role: 'system', content: 'Be helpful' })
      expect(result[1]).toEqual({ role: 'user', content: 'hi' })
    })

    it('converts string content directly', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toOllamaMessages(messages)
      expect(result).toEqual([{ role: 'user', content: 'hello' }])
    })

    it('converts image blocks to images array', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc123' } },
        ],
      }]
      const result = toOllamaMessages(messages)
      expect(result[0].content).toBe('What is this?')
      expect(result[0].images).toEqual(['abc123'])
    })

    it('converts tool_result blocks to tool role messages', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'c1', content: 'result data' }],
      }]
      const result = toOllamaMessages(messages)
      expect(result[0]).toEqual({ role: 'tool', content: 'result data' })
      expect(result[0]).not.toHaveProperty('tool_name')
    })

    it('links a tool result to its call by function name (tool_name)', () => {
      const messages: ModelMessage[] = [
        { role: 'assistant', content: [
          { type: 'tool_use', id: 'c1', name: 'memory_search', input: { query: 'q' } },
          { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: '/w/a' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', toolUseId: 'c1', content: 'found' },
          { type: 'tool_result', toolUseId: 'c2', content: 'text' },
        ] },
      ]
      const result = toOllamaMessages(messages)
      expect(result.slice(1)).toEqual([
        { role: 'tool', content: 'found', tool_name: 'memory_search' },
        { role: 'tool', content: 'text', tool_name: 'read_file' },
      ])
    })

    it('converts tool_use blocks to tool_calls', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search' },
          { type: 'tool_use', id: 'c1', name: 'search', input: { q: 'weather' } },
        ],
      }]
      const result = toOllamaMessages(messages)
      expect(result[0].role).toBe('assistant')
      expect(result[0].content).toBe('Let me search')
      expect(result[0].tool_calls).toEqual([{
        function: { name: 'search', arguments: { q: 'weather' } },
      }])
    })
  })

  describe('toOllamaTools', () => {
    it('wraps tools in function format', () => {
      const tools: ToolDefinition[] = [{
        name: 'search', description: 'Search the web', inputSchema: { type: 'object' },
      }]
      const result = toOllamaTools(tools)
      expect(result).toEqual([{
        type: 'function',
        function: { name: 'search', description: 'Search the web', parameters: { type: 'object' } },
      }])
    })
  })

  describe('fromOllamaResponse', () => {
    it('converts a text response', () => {
      const raw = {
        model: 'llama3.2',
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }
      const result = fromOllamaResponse(raw as any, 'ollama')
      expect(result.provider).toBe('ollama')
      expect(result.model).toBe('llama3.2')
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
      expect(result.stopReason).toBe('end')
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    })

    it('converts tool call response', () => {
      const raw = {
        model: 'llama3.2',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'search', arguments: { q: 'test' } } }],
        },
        done: true,
        prompt_eval_count: 20,
        eval_count: 15,
      }
      const result = fromOllamaResponse({ ...raw, done_reason: 'stop' } as any, 'ollama')
      expect(result.stopReason).toBe('tool_use')
      expect(fromOllamaResponse(raw as any, 'ollama').stopReason).toBe('tool_use')
      expect(result.content.length).toBe(1)
      expect(result.content[0].type).toBe('tool_use')
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search')
        expect(result.content[0].input).toEqual({ q: 'test' })
      }
    })
  })

  describe('stop reason (shared normalizeStopReason)', () => {
    const base = { model: 'llama3.2', done: true, prompt_eval_count: 1, eval_count: 1 }
    it('maps a done text reply to end', () => {
      expect(fromOllamaResponse({ ...base, done_reason: 'stop', message: { role: 'assistant', content: 'hi' } } as any, 'ollama').stopReason).toBe('end')
    })
    it("maps done_reason 'length' to max_tokens, even with a (truncated) call", () => {
      const message = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'memory_search', arguments: {} } }] }
      expect(fromOllamaResponse({ ...base, done_reason: 'length', message } as any, 'ollama').stopReason).toBe('max_tokens')
    })
  })

  describe('createOllamaAdapter', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    describe('ping', () => {
      it('returns true when Ollama is reachable', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any
        const adapter = createOllamaAdapter('http://localhost:11434')
        expect(await adapter.ping()).toBe(true)
      })

      it('returns false when Ollama is unreachable', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any
        const adapter = createOllamaAdapter('http://localhost:11434')
        expect(await adapter.ping()).toBe(false)
      })
    })

    describe('listModels', () => {
      it('returns mapped model info from /api/tags', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3.2:latest', size: 4_000_000_000, details: { parameter_size: '8B', family: 'llama' } },
              { name: 'llava:13b', size: 8_000_000_000, details: { parameter_size: '13B', family: 'llama' } },
            ],
          }),
        }) as any

        const adapter = createOllamaAdapter('http://localhost:11434')
        const models = await adapter.listModels()

        expect(models).toHaveLength(2)
        expect(models[0].id).toBe('llama3.2:latest')
        expect(models[0].provider).toBe('ollama')
        expect(models[0].supportsImages).toBe(false)
        expect(models[1].id).toBe('llava:13b')
        expect(models[1].supportsImages).toBe(true)
        expect(models[1].contextWindow).toBe(32768)
      })

      it('(−) reads /api/tags only: no per-model /api/show call on a plain listing', async () => {
        const fetchMock = vi.fn(async (url: string) => {
          if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'a', size: 1, details: {} }, { name: 'b', size: 1, details: {} }] }) }
          throw new Error(`unexpected ${url}`)
        })
        globalThis.fetch = fetchMock as any
        const models = await createOllamaAdapter('http://localhost:11434').listModels()
        expect(models.map((m) => m.id)).toEqual(['a', 'b'])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(models.every((m) => m.metadata === undefined)).toBe(true)
      })
    })

    describe('fetchModelsWithCapabilities (discovery)', () => {
      it('(+) derives supportsTools from /api/show capabilities (I7)', async () => {
        globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
          if (url.endsWith('/api/tags')) {
            return { ok: true, json: async () => ({ models: [
              { name: 'tooly', size: 1, details: { parameter_size: '8B' } },
              { name: 'plain', size: 1, details: { parameter_size: '8B' } },
            ] }) }
          }
          const model = JSON.parse(String(init?.body)).model
          return { ok: true, json: async () => ({ capabilities: model === 'tooly' ? ['completion', 'tools'] : ['completion'] }) }
        }) as any
        const models = await createOllamaAdapter('http://localhost:11434').fetchModelsWithCapabilities()
        expect(models.find((m) => m.id === 'tooly')?.supportsTools).toBe(true)
        expect(models.find((m) => m.id === 'plain')?.supportsTools).toBe(false)
      })

      it('(−) keeps tools when /api/show fails or reports no capabilities', async () => {
        globalThis.fetch = vi.fn(async (url: string) => {
          if (url.endsWith('/api/tags')) {
            return { ok: true, json: async () => ({ models: [{ name: 'old', size: 1, details: {} }, { name: 'down', size: 1, details: {} }] }) }
          }
          return { ok: false, json: async () => ({}) }
        }) as any
        const models = await createOllamaAdapter('http://localhost:11434').fetchModelsWithCapabilities()
        expect(models.every((m) => m.supportsTools)).toBe(true)
      })
    })

    describe('num_ctx (I7)', () => {
      const big = [{ role: 'user', content: 'x'.repeat(40_000) }] // ~10k tokens

      it('(+) set only when the request outgrows the default, as a power of two capped at the window', () => {
        expect(ollamaNumCtx(big, undefined, undefined, 32_768)).toBe(16_384)
        expect(ollamaNumCtx(big, undefined, undefined, 12_000)).toBe(12_000)
        expect(ollamaNumCtx(big, undefined, 8_000, 131_072)).toBe(32_768)
      })

      it('(−) not set for a small request, without a resolved window, or when the window is no larger than the default', () => {
        expect(ollamaNumCtx([{ role: 'user', content: 'hi' }], undefined, undefined, 32_768)).toBeUndefined()
        expect(ollamaNumCtx(big, undefined, undefined, undefined)).toBeUndefined()
        expect(ollamaNumCtx(big, undefined, undefined, OLLAMA_DEFAULT_NUM_CTX)).toBeUndefined()
      })

      it('(+) complete() sends options.num_ctx for a large request; (−) none for a small one', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'm', message: { role: 'assistant', content: 'ok' }, done: true }) })
        globalThis.fetch = fetchMock as any
        const adapter = createOllamaAdapter('http://localhost:11434')
        await adapter.complete({ model: 'm', messages: [{ role: 'user', content: 'x'.repeat(40_000) }], contextWindow: 32_768 })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).options).toEqual({ num_ctx: 16_384 })
        await adapter.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }], contextWindow: 32_768 })
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('options')
      })
    })

    describe('complete', () => {
      it('sends POST to /api/chat and returns ModelResponse', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            model: 'llama3.2',
            message: { role: 'assistant', content: 'Hi there!' },
            done: true,
            prompt_eval_count: 8,
            eval_count: 4,
          }),
        }) as any

        const adapter = createOllamaAdapter('http://localhost:11434')
        const response = await adapter.complete({
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'Hello' }],
        })

        expect(response.model).toBe('llama3.2')
        expect(response.content).toEqual([{ type: 'text', text: 'Hi there!' }])
        expect(response.usage).toEqual({ inputTokens: 8, outputTokens: 4 })

        // Verify fetch was called with correct params
        const call = (globalThis.fetch as any).mock.calls[0]
        expect(call[0]).toBe('http://localhost:11434/api/chat')
        const body = JSON.parse(call[1].body)
        expect(body.stream).toBe(false)
        expect(body.model).toBe('llama3.2')
      })
    })

    describe('stream', () => {
      function ndjsonResponse(lines: unknown[]) {
        const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
        return { ok: true, body: new Response(body).body }
      }

      async function drain(adapter: ReturnType<typeof createOllamaAdapter>) {
        const events: any[] = []
        for await (const e of adapter.stream({ model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }] })) events.push(e)
        return events
      }

      it('stops a streamed tool call for tool_use through the shared helper', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(ndjsonResponse([
          { model: 'llama3.2', message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'memory_search', arguments: { query: 'q' } } }] }, done: false },
          { model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 2 },
        ])) as any
        const events = await drain(createOllamaAdapter('http://localhost:11434'))
        const done = events.find((e) => e.type === 'done')
        expect(done.response.stopReason).toBe('tool_use')
        const start = events.find((e) => e.type === 'tool_use_start')
        expect(done.response.content.find((b: any) => b.type === 'tool_use').id).toBe(start.id)
        // The row settles on the runner's tool_result, never before the call ran.
        expect(events.some((e) => e.type === 'tool_use_end')).toBe(false)
      })

      it('ends a streamed text reply with end', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(ndjsonResponse([
          { model: 'llama3.2', message: { role: 'assistant', content: 'hel' }, done: false },
          { model: 'llama3.2', message: { role: 'assistant', content: 'lo' }, done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 2 },
        ])) as any
        const events = await drain(createOllamaAdapter('http://localhost:11434'))
        const done = events.find((e) => e.type === 'done')
        expect(done.response.stopReason).toBe('end')
        expect(done.response.content).toEqual([{ type: 'text', text: 'hello' }])
      })
    })

    describe('Stop (request.signal)', () => {
      const encoder = new TextEncoder()
      const line = (l: unknown) => encoder.encode(JSON.stringify(l) + '\n')

      /** A body that sends one text chunk and then stalls until cancelled. */
      function stallingBody() {
        const state = { cancelled: false, pulls: 0 }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(line({ model: 'llama3.2', message: { role: 'assistant', content: 'Hel' }, done: false }))
          },
          pull() { state.pulls++ /* never enqueues: generation still running */ },
          cancel() { state.cancelled = true },
        })
        return { body, state }
      }

      it('passes the signal to fetch in complete() and rejects with an abort-kind error', async () => {
        const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
        }))
        globalThis.fetch = fetchMock as any
        const controller = new AbortController()
        const pending = createOllamaAdapter('http://localhost:11434').complete({
          model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal,
        })
        expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
        controller.abort()
        const err = await pending.then(() => null, (e: unknown) => e)
        expect(classifyModelError(err).kind).toBe('aborted')
      })

      it('stops reading a stream when the signal aborts mid-generation and rejects with an abort-kind error', async () => {
        const { body, state } = stallingBody()
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body })
        globalThis.fetch = fetchMock as any
        const controller = new AbortController()
        const iterator = createOllamaAdapter('http://localhost:11434').stream({
          model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal,
        })[Symbol.asyncIterator]()

        expect((await iterator.next()).value).toEqual({ type: 'text', text: 'Hel' })
        expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
        // The read after the first chunk is pending on a generation that never ends.
        const pending = iterator.next()
        await vi.waitFor(() => expect(state.pulls).toBeGreaterThan(0))
        controller.abort()

        const err = await pending.then(() => null, (e: unknown) => e)
        expect(classifyModelError(err).kind).toBe('aborted')
        expect(state.cancelled).toBe(true)
        // The iterator is finished: nothing more is read or yielded.
        expect(await iterator.next()).toEqual({ done: true, value: undefined })
      })

      it('rejects at once when the signal is already aborted after a chunk was yielded', async () => {
        const { body, state } = stallingBody()
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any
        const controller = new AbortController()
        const events: any[] = []
        const run = (async () => {
          for await (const e of createOllamaAdapter('http://localhost:11434').stream({
            model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal,
          })) {
            events.push(e)
            controller.abort()
          }
        })()
        const err = await run.then(() => null, (e: unknown) => e)
        expect(events).toEqual([{ type: 'text', text: 'Hel' }])
        expect(classifyModelError(err).kind).toBe('aborted')
        expect(state.cancelled).toBe(true)
      })

      it('surfaces a timeout reason as a timeout, not a user Stop', async () => {
        const { body } = stallingBody()
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any
        const controller = new AbortController()
        const iterator = createOllamaAdapter('http://localhost:11434').stream({
          model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal,
        })[Symbol.asyncIterator]()
        await iterator.next()
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
        const err = await iterator.next().then(() => null, (e: unknown) => e)
        expect(classifyModelError(err).kind).toBe('timeout')
      })

      it('without a signal: fetch gets none and the stream completes as before', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          body: new Response([
            JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: 'hi' }, done: true, done_reason: 'stop' }),
          ].join('\n') + '\n').body,
        })
        globalThis.fetch = fetchMock as any
        const events: any[] = []
        for await (const e of createOllamaAdapter('http://localhost:11434').stream({ model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }] })) events.push(e)
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('signal')
        expect(events.map((e) => e.type)).toEqual(['text', 'done'])
        expect(events[1].response.stopReason).toBe('end')

        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true }) }) as any
        await createOllamaAdapter('http://localhost:11434').complete({ model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }] })
        expect((globalThis.fetch as any).mock.calls[0][1]).not.toHaveProperty('signal')
      })

      it('cancels the HTTP stream when the consumer stops early', async () => {
        const { body, state } = stallingBody()
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any
        for await (const e of createOllamaAdapter('http://localhost:11434').stream({ model: 'llama3.2', messages: [{ role: 'user', content: 'hi' }] })) {
          expect(e).toEqual({ type: 'text', text: 'Hel' })
          break
        }
        expect(state.cancelled).toBe(true)
      })
    })

    describe('embed', () => {
      it('sends POST to /api/embed and returns vector', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
          }),
        }) as any

        const adapter = createOllamaAdapter('http://localhost:11434')
        const vector = await adapter.embed('nomic-embed-text', 'Hello world')

        expect(vector).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])

        const call = (globalThis.fetch as any).mock.calls[0]
        expect(call[0]).toBe('http://localhost:11434/api/embed')
        const body = JSON.parse(call[1].body)
        expect(body.model).toBe('nomic-embed-text')
        expect(body.input).toBe('Hello world')
      })
    })
  })
})

// F3 — Anthropic-dialect reasoning never reaches the Ollama wire.
describe('Ollama adapter — thinking blocks never leak into the payload (negative)', () => {
  const thinking = {
    type: 'thinking' as const, thinking: 'SECRET-REASONING', signature: 'SIG-XYZ',
    origin: 'anthropic' as const, providerId: 'anthropic', modelId: 'claude-opus-4-8',
  }

  it('drops the block from tool and text turns', () => {
    const result = toOllamaMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'c1', name: 'fn', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'r' }] },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'Done.' }] },
    ])
    const wire = JSON.stringify(result)
    expect(wire).not.toContain('SECRET-REASONING')
    expect(wire).not.toContain('SIG-XYZ')
    expect(result[3]).toEqual({ role: 'assistant', content: 'Done.' })
  })

  it('an assistant turn that carried only reasoning is not sent as an empty message', () => {
    const result = toOllamaMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking] },
    ])
    expect(result).toEqual([{ role: 'user', content: 'q' }])
  })
})
