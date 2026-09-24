// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code turns as the Agent SDK delivers them with partial messages on
// (includePartialMessages): stream_event deltas for every main-thread model
// call, the complete assistant message per content block after its deltas,
// user messages carrying the runtime's tool results, and one result message.
// The system/init message is prepended by the test's fake query() (it depends
// on the query options). For the stream-contract harness.

import type { ApiStreamFixture } from './types.js'

type Message = Record<string, unknown>

/** A Claude Code fixture: what the normalized stream must end with, plus the runtime-reported window. */
export interface ClaudeCodeStreamFixture extends ApiStreamFixture<Message> {
  expected: ApiStreamFixture<Message>['expected'] & {
    /** The context window of the model that answered (result.modelUsage). */
    contextWindow?: number
    /** Each tool row's settled outcome and executor, by tool id. */
    results?: Record<string, { outcome: string; executedBy: 'eyas' | 'provider' }>
    /** The answer text streamed, in order. */
    text: string[]
    steps: number
  }
}

const main = (event: Message): Message => ({ type: 'stream_event', parent_tool_use_id: null, session_id: 'fx', uuid: 'u', event })

const start = (id: string, usage: Message): Message => main({
  type: 'message_start',
  message: { id, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, usage: { output_tokens: 1, ...usage } },
})

const assistant = (id: string, block: Message): Message => ({
  type: 'assistant',
  parent_tool_use_id: null,
  session_id: 'fx',
  uuid: 'u',
  message: { id, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [block] },
})

const toolResult = (toolUseId: string, content: unknown, isError = false): Message => ({
  type: 'user',
  parent_tool_use_id: null,
  session_id: 'fx',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  tool_use_result: {},
})

/** Thinking, text, one Read of a workspace file, then the answer in a second model call. */
export const claudeCodeReadTurn: ClaudeCodeStreamFixture = {
  name: 'claude-code: thinking + text + native Read + answer',
  chunks: [
    start('msg_fx1', { input_tokens: 12, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200 }),
    main({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    main({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The user wants the file.' } }),
    main({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
    main({ type: 'content_block_stop', index: 0 }),
    assistant('msg_fx1', { type: 'thinking', thinking: 'The user wants the file.', signature: 'sig' }),
    main({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    main({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me ' } }),
    main({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'read it.' } }),
    main({ type: 'content_block_stop', index: 1 }),
    assistant('msg_fx1', { type: 'text', text: 'Let me read it.' }),
    main({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_fx1', name: 'Read', input: {} } }),
    main({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } }),
    main({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"/work/notes.txt"}' } }),
    main({ type: 'content_block_stop', index: 2 }),
    assistant('msg_fx1', { type: 'tool_use', id: 'toolu_fx1', name: 'Read', input: { file_path: '/work/notes.txt' } }),
    main({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } }),
    main({ type: 'message_stop' }),
    toolResult('toolu_fx1', [{ type: 'text', text: '     1\thello' }]),
    start('msg_fx2', { input_tokens: 20, cache_read_input_tokens: 3200, cache_creation_input_tokens: 0 }),
    main({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    main({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The file says hello.' } }),
    main({ type: 'content_block_stop', index: 0 }),
    assistant('msg_fx2', { type: 'text', text: 'The file says hello.' }),
    main({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }),
    main({ type: 'message_stop' }),
    {
      type: 'result', subtype: 'success', is_error: false, num_turns: 2, session_id: 'fx',
      result: 'The file says hello.', stop_reason: 'end_turn', total_cost_usd: 0.0123,
      usage: { input_tokens: 32, output_tokens: 40, cache_read_input_tokens: 6200, cache_creation_input_tokens: 200 },
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 300, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.0003, contextWindow: 200_000, maxOutputTokens: 64_000 },
        'claude-sonnet-4-6': { inputTokens: 32, outputTokens: 40, cacheReadInputTokens: 6200, cacheCreationInputTokens: 200, webSearchRequests: 0, costUSD: 0.012, contextWindow: 1_000_000, maxOutputTokens: 64_000 },
      },
      permission_denials: [],
    },
  ],
  expected: {
    toolCalls: 1,
    toolUseIds: ['toolu_fx1'],
    stopReason: 'end',
    usage: {
      inputTokens: 32, outputTokens: 40, cacheReadTokens: 6200, cacheCreationTokens: 200,
      reported: true, costUsd: 0.0123, promptTokensLastCall: 3220,
    },
    contextWindow: 1_000_000,
    results: { toolu_fx1: { outcome: 'success', executedBy: 'provider' } },
    text: ['Let me ', 'read it.', 'The file says hello.'],
    steps: 2,
  },
}

/** A bridged EYAS tool, then the runtime's own turn limit: an outcome with the partial answer. */
export const claudeCodeBridgedToolAtTurnLimit: ClaudeCodeStreamFixture = {
  name: 'claude-code: bridged EYAS tool, then the turn limit',
  chunks: [
    start('msg_fx3', { input_tokens: 40 }),
    main({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching memory.' } }),
    assistant('msg_fx3', { type: 'text', text: 'Searching memory.' }),
    assistant('msg_fx3', { type: 'tool_use', id: 'toolu_fx3', name: 'mcp__eyas__memory_search', input: { query: 'deadline' } }),
    toolResult('toolu_fx3', 'no results'),
    { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150_000 }, session_id: 'fx', uuid: 'u' },
    {
      type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 1, session_id: 'fx', stop_reason: 'tool_use',
      total_cost_usd: 0.002, usage: { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: { 'claude-sonnet-4-6': { inputTokens: 40, outputTokens: 12, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.002, contextWindow: 200_000, maxOutputTokens: 64_000 } },
      permission_denials: [], errors: [],
    },
  ],
  expected: {
    toolCalls: 1,
    toolUseIds: ['toolu_fx3'],
    stopReason: 'max_turns',
    usage: { inputTokens: 40, outputTokens: 12, reported: true, costUsd: 0.002, promptTokensLastCall: 40 },
    contextWindow: 200_000,
    results: { toolu_fx3: { outcome: 'success', executedBy: 'eyas' } },
    text: ['Searching memory.'],
    steps: 1,
  },
}

export const CLAUDE_CODE_FIXTURES: readonly ClaudeCodeStreamFixture[] = [claudeCodeReadTurn, claudeCodeBridgedToolAtTurnLimit]
