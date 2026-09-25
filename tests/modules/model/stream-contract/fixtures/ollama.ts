// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// /api/chat NDJSON lines, as a local Ollama server streams them, for the
// stream-contract harness.

import type { ApiStreamFixture } from './types.js'

type Line = Record<string, unknown>

/** One tool call, then the final (done) line with the counts. */
export const ollamaToolTurn: ApiStreamFixture<Line> = {
  name: 'ollama: tool call',
  chunks: [
    { model: 'llama3.2', message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'memory_search', arguments: { query: 'q' } } }] }, done: false },
    { model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 60, eval_count: 12 },
  ],
  expected: {
    // Ollama's wire has no call ids: the adapter mints one per call.
    toolCalls: 1,
    stopReason: 'tool_use',
    usage: { inputTokens: 60, outputTokens: 12 },
  },
}

/** A reply cut off by num_predict, from a server that reports no counts. */
export const ollamaTruncatedTurnWithoutUsage: ApiStreamFixture<Line> = {
  name: 'ollama: length stop, no counts',
  chunks: [
    { model: 'llama3.2', message: { role: 'assistant', content: 'The deadl' }, done: false },
    { model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'length' },
  ],
  expected: {
    toolCalls: 0,
    stopReason: 'max_tokens',
    usage: { inputTokens: 0, outputTokens: 0, reported: false },
  },
}
