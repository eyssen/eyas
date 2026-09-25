// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Messages API streams (the Anthropic API and every Anthropic-compatible
// endpoint) in the shape the API sends them, for the stream-contract harness.

import type { ApiStreamFixture } from './types.js'

type Event = Record<string, unknown>

/** Text, then one tool call; cache usage at message_start, output at message_delta. */
export const anthropicToolTurn: ApiStreamFixture<Event> = {
  name: 'anthropic: text + tool call',
  chunks: [
    {
      type: 'message_start',
      message: {
        id: 'msg_fx1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 60 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_fx1', name: 'memory_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"deadline"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 31 } },
    { type: 'message_stop' },
  ],
  expected: {
    toolCalls: 1,
    toolUseIds: ['toolu_fx1'],
    stopReason: 'tool_use',
    usage: { inputTokens: 25, outputTokens: 31, cacheReadTokens: 900, cacheCreationTokens: 60, promptTokensLastCall: 985 },
  },
}

/** The model declines: stop_reason 'refusal'. */
export const anthropicRefusalTurn: ApiStreamFixture<Event> = {
  name: 'anthropic: refusal',
  chunks: [
    {
      type: 'message_start',
      message: {
        id: 'msg_fx2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 14, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I cannot help with that.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ],
  expected: {
    toolCalls: 0,
    stopReason: 'refusal',
    usage: { inputTokens: 14, outputTokens: 8, promptTokensLastCall: 14 },
  },
}
