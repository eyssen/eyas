import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createOllamaAdapter,
  toOllamaMessages,
  toOllamaTools,
  fromOllamaResponse,
  OllamaAdapter,
} from '@modules/model/submodules/ollama/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

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
      const result = fromOllamaResponse(raw as any, 'ollama')
      expect(result.stopReason).toBe('tool_use')
      expect(result.content.length).toBe(1)
      expect(result.content[0].type).toBe('tool_use')
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search')
        expect(result.content[0].input).toEqual({ q: 'test' })
      }
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

describe('OllamaAdapter (v2)', () => {
  it('joins prefix + suffix + reminders into single system message and POSTs /api/chat', async () => {
    const originalFetch = global.fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'llama3.2',
        created_at: '2026-04-26T00:00:00Z',
        message: { role: 'assistant', content: 'ok' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    } as Response)
    global.fetch = fetchMock as never
    try {
      const adapter = new OllamaAdapter('http://localhost:11434')
      await adapter.send({
        systemPrompt: { prefix: 'PREFIX', suffix: 'SUFFIX', reminders: ['REM'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 }, sections: [] },
        messages: [{ role: 'user', content: 'hi' }],
        modelId: 'llama3.2',
      })
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({ method: 'POST' }))
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.messages[0]).toEqual({ role: 'system', content: 'PREFIX\n\nSUFFIX\n\nREM' })
      expect(body.messages[1]).toMatchObject({ role: 'user' })
      expect(body.stream).toBe(false)
    } finally {
      global.fetch = originalFetch
    }
  })
})
