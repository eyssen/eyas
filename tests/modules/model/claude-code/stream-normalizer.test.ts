// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G2 — the Claude Code stream normalizer on its own: the turn's end from the
// SDK result message (usage, window of the model that answered) and the
// approval bookkeeping, without a provider around it.

import { describe, it, expect } from 'vitest'
import { createClaudeStreamNormalizer } from '@modules/model/submodules/claude-code/stream-normalizer.js'
import { ProviderRunError } from '@shared/classify-model-error.js'

const usageEntry = (contextWindow: number, inputTokens = 10, outputTokens = 10) => ({
  inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow, maxOutputTokens: 64_000,
})

const success = (modelUsage?: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', result: 'ok', stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 }, ...(modelUsage ? { modelUsage } : {}),
})

function windowOf(end: ReturnType<ReturnType<typeof createClaudeStreamNormalizer>['finish']>): number | undefined {
  return end.kind === 'done' ? end.response.contextWindow : undefined
}

describe('stream normalizer — the context window of the model that answered', () => {
  it('picks the modelUsage entry of the main-thread model, not a helper model', () => {
    const n = createClaudeStreamNormalizer({ model: 'claude-code-opus' })
    n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } } })
    expect(windowOf(n.finish(success({
      'claude-haiku-4-5': usageEntry(200_000, 5000, 5000),
      'claude-opus-5-5': usageEntry(1_000_000, 10, 10),
    })))).toBe(1_000_000)
  })

  it('matches a key that differs only by a context suffix, and falls back to the init model', () => {
    const n = createClaudeStreamNormalizer({ model: 'claude-code-sonnet' })
    n.observeInit({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' })
    expect(windowOf(n.finish(success({
      'claude-haiku-4-5': usageEntry(200_000, 5000, 5000),
      'claude-sonnet-4-6[1m]': usageEntry(1_000_000),
    })))).toBe(1_000_000)
  })

  it('with no known main model: the only entry, else the busiest one', () => {
    const one = createClaudeStreamNormalizer({ model: 'm' })
    expect(windowOf(one.finish(success({ x: usageEntry(123_000) })))).toBe(123_000)
    const two = createClaudeStreamNormalizer({ model: 'm' })
    expect(windowOf(two.finish(success({ small: usageEntry(200_000, 1, 1), big: usageEntry(400_000, 900, 900) })))).toBe(400_000)
  })

  it('no modelUsage, or a malformed one, gives no window rather than a guess (negative)', () => {
    expect(windowOf(createClaudeStreamNormalizer({ model: 'm' }).finish(success()))).toBeUndefined()
    expect(windowOf(createClaudeStreamNormalizer({ model: 'm' }).finish(success({ x: { contextWindow: 'huge' } })))).toBeUndefined()
  })
})

describe('stream normalizer — the turn end', () => {
  it('a malformed result is a failed run, never a clean done (negative)', () => {
    const end = createClaudeStreamNormalizer({ model: 'm' }).finish({ type: 'result' })
    expect(end.kind).toBe('failed')
    expect(end.kind === 'failed' && end.error).toBeInstanceOf(ProviderRunError)
  })

  it('a stream without a result ends on what it streamed, usage not reported', () => {
    const n = createClaudeStreamNormalizer({ model: 'm' })
    n.push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'partial' }] } })
    const response = n.finishWithoutResult()
    expect(response.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
  })
})

describe('stream normalizer — approvals', () => {
  it('holds an approval until its row opened; `final` flushes it anyway', () => {
    const n = createClaudeStreamNormalizer({ model: 'm' })
    n.recordDecision({ toolUseId: 't1', toolName: 'Bash', outcome: 'approval_required', reason: 'r', approvalId: 3 })
    expect(n.drainApprovals()).toEqual([])
    expect(n.drainApprovals({ final: true })).toEqual([{ type: 'approval_required', toolUseId: 't1', toolName: 'run_command', reason: 'r', approvalId: 3 }])
    expect(n.drainApprovals({ final: true })).toEqual([])
  })

  it('announces a call without an id at once; a denial is never an approval card (negative)', () => {
    const n = createClaudeStreamNormalizer({ model: 'm' })
    n.recordDecision({ toolUseId: '', toolName: 'Write', outcome: 'approval_required', reason: 'r' })
    n.recordDecision({ toolUseId: 't2', toolName: 'Bash', outcome: 'denied', reason: 'no' })
    expect(n.drainApprovals()).toEqual([{ type: 'approval_required', toolName: 'write_file', reason: 'r' }])
    expect(n.drainApprovals({ final: true })).toEqual([])
  })

  it('settles only refused rows the runtime left open', () => {
    const n = createClaudeStreamNormalizer({ model: 'm', now: () => 1000 })
    n.push({ type: 'assistant', parent_tool_use_id: null, message: { content: [
      { type: 'tool_use', id: 'refused', name: 'Bash', input: {} },
      { type: 'tool_use', id: 'running', name: 'Read', input: {} },
    ] } })
    n.recordDecision({ toolUseId: 'refused', toolName: 'Bash', outcome: 'denied', reason: 'no' })
    expect(n.settleRefused()).toEqual([{ type: 'tool_result', toolUseId: 'refused', content: 'no', isError: true, durationMs: 0, outcome: 'denied', executedBy: 'provider' }])
    expect(n.settleRefused()).toEqual([])
  })
})
