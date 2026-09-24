// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Tool-loop contract across the API adapters (H1). Whatever the backend says
// when it stops, a response that carries tool calls must stop for 'tool_use'
// so the runner executes them — and the next request must link each result
// to its call in that provider's own wire format.

import { describe, it, expect } from 'vitest'
import { fromGeminiResponse, toGeminiContents } from '@modules/model/submodules/gemini/adapter'
import { fromOpenAIResponse, toOpenAIMessages } from '@modules/model/submodules/openai/adapter'
import { fromOllamaResponse, toOllamaMessages } from '@modules/model/submodules/ollama/adapter'
import type { ModelMessage, ModelResponse, ToolUseBlock } from '@modules/model/types'

interface AdapterFixture {
  /** A response with one memory_search call and the backend's plain-stop finish. */
  callWithPlainStop: () => ModelResponse
  /** The same call, cut off by the output budget. */
  callWithBudgetStop: () => ModelResponse
  /** A text-only reply with the backend's plain-stop finish. */
  textWithPlainStop: () => ModelResponse
  /** The next request's wire messages for [assistant tool_use, user tool_result]. */
  toWire: (messages: ModelMessage[]) => any[]
  /** The wire message/part that answers the call, and how it names the call. */
  resultLink: (wire: any[]) => { id?: string; name?: string }
}

const ADAPTERS: Record<string, AdapterFixture> = {
  gemini: {
    callWithPlainStop: () => fromGeminiResponse({
      candidates: [{ content: { parts: [{ functionCall: { id: 'fc-1', name: 'memory_search', args: { query: 'q' } } }] }, finishReason: 'STOP' }],
    }),
    callWithBudgetStop: () => fromGeminiResponse({
      candidates: [{ content: { parts: [{ functionCall: { id: 'fc-1', name: 'memory_search', args: {} } }] }, finishReason: 'MAX_TOKENS' }],
    }),
    textWithPlainStop: () => fromGeminiResponse({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }),
    toWire: (messages) => toGeminiContents(messages),
    resultLink: (wire) => {
      const fr = wire[1].parts[0].functionResponse
      return { id: fr.id, name: fr.name }
    },
  },
  'openai-compat': {
    callWithPlainStop: () => fromOpenAIResponse({
      id: 'x', model: 'local',
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'memory_search', arguments: '{"query":"q"}' } }] },
        finish_reason: 'stop',
      }],
    }, 'openai-compat'),
    callWithBudgetStop: () => fromOpenAIResponse({
      id: 'x', model: 'local',
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'memory_search', arguments: '{"que' } }] },
        finish_reason: 'length',
      }],
    }, 'openai-compat'),
    textWithPlainStop: () => fromOpenAIResponse({
      id: 'x', model: 'local', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    }, 'openai-compat'),
    toWire: (messages) => toOpenAIMessages(messages),
    resultLink: (wire) => {
      // The tool message names the call by id; the call carries the function name.
      const toolMsg = wire.find((m) => m.role === 'tool')
      const call = wire[0].tool_calls.find((c: any) => c.id === toolMsg.tool_call_id)
      return { id: toolMsg.tool_call_id, name: call?.function.name }
    },
  },
  // LM Studio runs on the shared OpenAI provider (H2); some local servers send
  // a call without an id, and the synthesized one must still link the result.
  lmstudio: {
    callWithPlainStop: () => fromOpenAIResponse({
      id: 'x', model: 'local',
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'memory_search', arguments: '{"query":"q"}' } }] },
        finish_reason: 'stop',
      }],
    }, 'lmstudio'),
    callWithBudgetStop: () => fromOpenAIResponse({
      id: 'x', model: 'local',
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'memory_search', arguments: '{"que' } }] },
        finish_reason: 'length',
      }],
    }, 'lmstudio'),
    textWithPlainStop: () => fromOpenAIResponse({
      id: 'x', model: 'local', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    }, 'lmstudio'),
    toWire: (messages) => toOpenAIMessages(messages),
    resultLink: (wire) => {
      const toolMsg = wire.find((m) => m.role === 'tool')
      const call = wire[0].tool_calls.find((c: any) => c.id === toolMsg.tool_call_id)
      return { id: toolMsg.tool_call_id, name: call?.function.name }
    },
  },
  ollama: {
    callWithPlainStop: () => fromOllamaResponse({
      model: 'llama3.2', done: true, done_reason: 'stop',
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'memory_search', arguments: { query: 'q' } } }] },
    }, 'ollama'),
    callWithBudgetStop: () => fromOllamaResponse({
      model: 'llama3.2', done: true, done_reason: 'length',
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'memory_search', arguments: {} } }] },
    }, 'ollama'),
    textWithPlainStop: () => fromOllamaResponse({
      model: 'llama3.2', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'hi' },
    }, 'ollama'),
    toWire: (messages) => toOllamaMessages(messages),
    // Ollama's wire format has no call ids: results are linked by function name, in call order.
    resultLink: (wire) => ({ name: wire.find((m) => m.role === 'tool').tool_name }),
  },
}

describe.each(Object.entries(ADAPTERS))('tool-loop contract — %s', (_id, adapter) => {
  it("stops for 'tool_use' when a call arrives with a plain-stop finish", () => {
    const response = adapter.callWithPlainStop()
    expect(response.stopReason).toBe('tool_use')
    expect(response.content.filter((b) => b.type === 'tool_use')).toHaveLength(1)
  })

  it('links the result to its call (id where the wire has one, and the function name)', () => {
    const call = adapter.callWithPlainStop().content.find((b) => b.type === 'tool_use') as ToolUseBlock
    const wire = adapter.toWire([
      { role: 'assistant', content: [call] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: 'found' }] },
    ])
    const link = adapter.resultLink(wire)
    expect(link.name).toBe('memory_search')
    if (link.id !== undefined) expect(link.id).toBe(call.id)
  })

  it("ends a text-only plain stop with 'end'", () => {
    expect(adapter.textWithPlainStop().stopReason).toBe('end')
  })

  it("keeps 'max_tokens' when the call was cut off by the budget", () => {
    expect(adapter.callWithBudgetStop().stopReason).toBe('max_tokens')
  })
})
