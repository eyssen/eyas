// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// generateContentStream chunks, as the @google/genai SDK yields them, for the
// stream-contract harness.

import type { ApiStreamFixture } from './types.js'

type Chunk = Record<string, unknown>

/**
 * Text, then one function call (Gemini 3 numbers its calls); each chunk
 * reports the counts so far, the last one with cached content and thinking
 * tokens.
 */
export const geminiToolTurn: ApiStreamFixture<Chunk> = {
  name: 'gemini: text + function call',
  chunks: [
    {
      responseId: 'resp-fx1', modelVersion: 'gemini-3-pro',
      candidates: [{ content: { role: 'model', parts: [{ text: 'Checking.' }] } }],
      usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 1000, candidatesTokenCount: 3, thoughtsTokenCount: 50 },
    },
    {
      responseId: 'resp-fx1', modelVersion: 'gemini-3-pro',
      candidates: [{
        content: { role: 'model', parts: [{ functionCall: { id: 'fc-fx1', name: 'memory_search', args: { query: 'q' } }, thoughtSignature: 'U0lH' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 1000, candidatesTokenCount: 20, thoughtsTokenCount: 180 },
    },
  ],
  expected: {
    toolCalls: 1,
    toolUseIds: ['fc-fx1'],
    stopReason: 'tool_use',
    usage: { inputTokens: 200, outputTokens: 200, cacheReadTokens: 1000, reasoningTokens: 180, promptTokensLastCall: 1200 },
  },
}

/** A SAFETY stop mid-answer: the vendor refused to continue. */
export const geminiSafetyTurn: ApiStreamFixture<Chunk> = {
  name: 'gemini: SAFETY stop',
  chunks: [
    { responseId: 'resp-fx2', candidates: [{ content: { role: 'model', parts: [{ text: 'Here is' }] } }] },
    {
      responseId: 'resp-fx2',
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 2 },
    },
  ],
  expected: {
    toolCalls: 0,
    stopReason: 'refusal',
    usage: { inputTokens: 40, outputTokens: 2, promptTokensLastCall: 40 },
  },
}
