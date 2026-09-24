// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Chat Completions streams (OpenAI, openai-compat, Kimi, OpenRouter and LM
// Studio all stream through the shared OpenAI provider), for the harness.

import type { ApiStreamFixture } from './types.js'

type Chunk = Record<string, unknown>

/**
 * Text, then two parallel tool calls streamed in argument fragments; the
 * usage chunk (stream_options.include_usage) reports a cached prompt share
 * and reasoning tokens.
 */
export const openaiToolTurn: ApiStreamFixture<Chunk> = {
  name: 'openai: text + parallel tool calls',
  chunks: [
    { id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', content: 'Looking.' } }] },
    { id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_fx1', type: 'function', function: { name: 'memory_search', arguments: '{"que' } }] } }] },
    { id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"q"}' } }] } }] },
    { id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_fx2', type: 'function', function: { name: 'read_file', arguments: '{"path":"/w/a"}' } }] } }] },
    { id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    {
      id: 'chatcmpl-fx1', model: 'gpt-4o', choices: [],
      usage: {
        prompt_tokens: 1000, completion_tokens: 120, total_tokens: 1120,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens_details: { reasoning_tokens: 64 },
      },
    },
  ],
  expected: {
    toolCalls: 2,
    toolUseIds: ['call_fx1', 'call_fx2'],
    stopReason: 'tool_use',
    usage: { inputTokens: 200, outputTokens: 120, cacheReadTokens: 800, reasoningTokens: 64, promptTokensLastCall: 1000 },
  },
}

/** A content filter stop from a backend that ignores stream_options (no usage chunk at all). */
export const openaiFilteredTurnWithoutUsage: ApiStreamFixture<Chunk> = {
  name: 'openai: content_filter, no usage reported',
  chunks: [
    { id: 'chatcmpl-fx2', model: 'local-model', choices: [{ index: 0, delta: { content: 'Partial' } }] },
    { id: 'chatcmpl-fx2', model: 'local-model', choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] },
  ],
  expected: {
    toolCalls: 0,
    stopReason: 'refusal',
    usage: { inputTokens: 0, outputTokens: 0, reported: false },
  },
}
