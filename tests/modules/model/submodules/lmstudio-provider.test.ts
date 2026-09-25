// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H2 — LM Studio runs on the shared OpenAI provider: history keeps its tool
// calls and results, request parameters reach the server, Stop cancels the
// in-flight call, and a memory_search round-trip reaches the model. The
// network is a mocked fetch; no LM Studio is assumed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLMStudioProvider, isLMStudioAvailable } from '@modules/model/submodules/lmstudio/provider'
import { createModelGateway } from '@modules/model/gateway'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { createToolHookRegistry } from '@modules/tools/hooks'
import { classifyModelError } from '@shared/classify-model-error'
import type { ModelRequest, StreamEvent } from '@modules/model/types'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  // The OpenAI client binds the global fetch when it is constructed, so the
  // stub must be in place before each provider is created.
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('LM_STUDIO_URL', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const completion = (message: Record<string, unknown>, finish_reason = 'stop') => ({
  id: 'chatcmpl-lms', object: 'chat.completion', created: 0, model: 'local-model',
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason }],
  usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
})

/** The JSON body of the n-th chat/completions request. */
function sentBody(n = 0): any {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))
  const init = calls[n]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const e of stream) events.push(e)
  return events
}

describe('LM Studio provider — wire format', () => {
  it('sends tool calls and tool results in history as assistant.tool_calls and role:tool', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({ content: 'done' })))
    const provider = createLMStudioProvider()

    await provider.complete({
      model: 'local-model',
      system: 'Be brief.',
      messages: [
        { role: 'user', content: 'When is the deadline?' },
        { role: 'assistant', content: [
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'call_1', name: 'memory_search', input: { query: 'deadline' } },
        ] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: 'deadline: Friday' }] },
      ],
    })

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:1234/v1/chat/completions')
    const body = sentBody()
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'When is the deadline?' },
      {
        role: 'assistant',
        content: 'Searching.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'memory_search', arguments: '{"query":"deadline"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'deadline: Friday' },
    ])
  })

  it('forwards temperature, maxTokens and stopSequences instead of a fixed temperature', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({ content: 'ok' })))
    const provider = createLMStudioProvider()

    await provider.complete({
      model: 'local-model',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxTokens: 321,
      stopSequences: ['END'],
    })

    const body = sentBody()
    expect(body.model).toBe('local-model')
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(321)
    expect(body.stop).toEqual(['END'])
  })

  it('omits temperature when the request sets none (the old fixed 0.7 is gone)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({ content: 'ok' })))
    await createLMStudioProvider().complete({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody()).not.toHaveProperty('temperature')
  })

  it('asks the loaded model when the request names none, never an OpenAI model id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({ content: 'ok' })))
    await createLMStudioProvider().complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().model).toBe('default')
  })

  it('reports tool calls with the provider id and a tool_use stop, even after a plain stop', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({
      content: null,
      tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'memory_search', arguments: '{"query":"q"}' } }],
    }, 'stop')))
    const response = await createLMStudioProvider().complete({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(response.provider).toBe('lmstudio')
    expect(response.stopReason).toBe('tool_use')
    expect(response.content).toEqual([{ type: 'tool_use', id: 'call_9', name: 'memory_search', input: { query: 'q' } }])
    expect(response.usage).toMatchObject({ inputTokens: 12, outputTokens: 4 })
  })

  it('uses the configured server URL, trailing slash or not', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completion({ content: 'ok' })))
    await createLMStudioProvider({ baseUrl: 'http://gpu.lan:1234/' }).complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://gpu.lan:1234/v1/chat/completions')
  })
})

describe('LM Studio provider — streaming', () => {
  it('opens one row per streamed call under the id its final block carries (backend sent none)', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { id: 's1', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, type: 'function', function: { name: 'memory_search', arguments: '' } }] } }] },
      { id: 's1', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] },
      { id: 's1', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"q"}' } }] }, finish_reason: 'stop' }] },
    ]))

    const events = await drain(createLMStudioProvider().stream({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] }))

    const starts = events.filter((e) => e.type === 'tool_use_start') as Array<{ id: string; name: string }>
    expect(starts).toHaveLength(1)
    expect(starts[0].id).toMatch(/^call_[0-9a-f-]{36}$/)
    const done = events.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }>
    expect(done.response.provider).toBe('lmstudio')
    expect(done.response.stopReason).toBe('tool_use')
    expect(done.response.content).toEqual([{ type: 'tool_use', id: starts[0].id, name: 'memory_search', input: { query: 'q' } }])
  })
})

describe('LM Studio provider — Stop', () => {
  it('rejects the in-flight call with an abort when request.signal aborts', async () => {
    let sawSignal = false
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal
      if (!signal) return
      sawSignal = true
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const controller = new AbortController()
    const pending = createLMStudioProvider().complete({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()

    const err = await pending.then(() => null, (e: unknown) => e)
    expect(sawSignal).toBe(true)
    expect(err).toBeTruthy()
    expect(classifyModelError(err).kind).toBe('aborted')
    // A cancelled call is never retried.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tears the HTTP stream down mid-generation when request.signal aborts', async () => {
    let serverSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => {
      serverSignal = init.signal ?? undefined
      const encoder = new TextEncoder()
      const first = { id: 's', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { content: 'Hel' } }] }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(first)}\n\n`))
          // Never closes on its own: only the abort ends it.
          init.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true })
        },
      })
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    })
    const controller = new AbortController()
    const seen: StreamEvent[] = []
    const run = (async () => {
      for await (const e of createLMStudioProvider().stream({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })) {
        seen.push(e)
        if (e.type === 'text') controller.abort()
      }
    })()

    // The OpenAI client ends an aborted stream quietly (the runner's turn
    // boundary reports the cancel); what matters is that the request to LM
    // Studio is torn down and nothing more is read from it.
    const err = await run.then(() => null, (e: unknown) => e)
    if (err) expect(classifyModelError(err).kind).toBe('aborted')
    expect(serverSignal?.aborted).toBe(true)
    expect(seen.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hel' }])
    expect(seen.filter((e) => e.type === 'tool_use_start')).toEqual([])
  })

  it('does not abort the request when no signal is given', async () => {
    let serverSignal: AbortSignal | null | undefined
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => {
      serverSignal = init.signal
      return Promise.resolve(jsonResponse(completion({ content: 'ok' })))
    })
    const response = await createLMStudioProvider().complete({ model: 'local-model', messages: [{ role: 'user', content: 'hi' }] })
    expect(response.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(serverSignal?.aborted ?? false).toBe(false)
  })
})

describe('LM Studio provider — models', () => {
  it('lists the models LM Studio has loaded', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [{ id: 'qwen2.5-7b-instruct' }] }))
    const provider = createLMStudioProvider()
    const models = await provider.listModels()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:1234/v1/models')
    expect(models).toEqual([expect.objectContaining({ id: 'qwen2.5-7b-instruct', provider: 'lmstudio', supportsTools: true })])
    expect(await provider.fetchModels!()).toEqual(models)
  })

  it('returns [] without throwing when the server is down or answers an error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await createLMStudioProvider().listModels()).toEqual([])
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    expect(await createLMStudioProvider().fetchModels!()).toEqual([])
  })

  it('isLMStudioAvailable is false when the server is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await isLMStudioAvailable()).toBe(false)
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))
    expect(await isLMStudioAvailable('http://localhost:1234')).toBe(true)
  })
})

describe('LM Studio provider — memory_search round-trip through the agent runner', () => {
  it('executes the call once and the next request carries its result to the model', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse([
        { id: 't1', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_mem', type: 'function', function: { name: 'memory_search', arguments: '{"query":"deadline"}' } }] } }] },
        { id: 't1', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]))
      .mockResolvedValueOnce(sseResponse([
        { id: 't2', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'The deadline is Friday.' }, finish_reason: 'stop' }] },
      ]))

    const gateway = createModelGateway()
    gateway.registerProvider(createLMStudioProvider())
    const execute = vi.fn(async () => ({ success: true, output: { result: 'deadline: Friday' }, durationMs: 3 }))
    const runner = createAgentRunner({ gateway, toolExecutor: { execute, hooks: createToolHookRegistry() } as any })

    const events: any[] = []
    for await (const e of runner.run({
      messages: [{ role: 'user', content: 'When is the deadline?' }],
      tools: [{ name: 'memory_search', description: 'Search memory', inputSchema: { type: 'object' } }],
      provider: 'lmstudio',
      model: 'local-model',
      maxTurns: 5,
    } as any)) events.push(e)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('memory_search', { query: 'deadline' }, undefined)
    // The second request replays the call and answers it by id on LM Studio's wire.
    const second = sentBody(1)
    const assistant = second.messages.find((m: any) => m.role === 'assistant')
    expect(assistant.tool_calls).toEqual([{ id: 'call_mem', type: 'function', function: { name: 'memory_search', arguments: '{"query":"deadline"}' } }])
    const toolMsg = second.messages.find((m: any) => m.role === 'tool')
    expect(toolMsg.tool_call_id).toBe('call_mem')
    expect(toolMsg.content).toContain('deadline: Friday')
    expect(events.find((e) => e.type === 'done').response.content[0].text).toBe('The deadline is Friday.')
  })

  it('never calls a tool for a text-only answer', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      { id: 't', object: 'chat.completion.chunk', created: 0, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi.' }, finish_reason: 'stop' }] },
    ]))
    const gateway = createModelGateway()
    gateway.registerProvider(createLMStudioProvider())
    const execute = vi.fn()
    const runner = createAgentRunner({ gateway, toolExecutor: { execute, hooks: createToolHookRegistry() } as any })
    const request: Partial<ModelRequest> & { maxTurns: number } = {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ name: 'memory_search', description: 'Search memory', inputSchema: { type: 'object' } }],
      provider: 'lmstudio',
      model: 'local-model',
      maxTurns: 5,
    }
    for await (const _ of runner.run(request as any)) { /* drain */ }
    expect(execute).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(1)
  })
})
