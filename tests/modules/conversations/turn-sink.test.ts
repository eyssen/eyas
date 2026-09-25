// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G7 — the chat route's ONE turn sink: every event becomes its frame, and the
// turn ends exactly once whatever the outcome (reply or partial answer
// persisted with a validated TurnMeta, cost recorded once, one terminal frame,
// one post-turn memory capture).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service.js'
import { createTurnSink, type TurnSinkDeps } from '@modules/conversations/turn-sink.js'
import { CodedModelError, ProviderRunError } from '@shared/classify-model-error.js'
import { TurnMetaSchema, type ChatStreamFrame, type TurnMeta } from '@shared/chat-stream.js'
import { estimateCost } from '@shared/model-pricing.js'
import type { ModelResponse, ModelUsage } from '@modules/model/types.js'

const testDb = createTestDb('turn-sink')

let chatService: ConversationService
let conversationId: string
let frames: ChatStreamFrame[]
let capture: Mock

beforeEach(async () => {
  const db = testDb.open()
  const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
  chatService = createConversationService(db)
  conversationId = chatService.create({ userId, title: 'T', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }).id
  chatService.addMessage(conversationId, { role: 'user', content: 'question', author: 'owner', entryPath: 'interactive' })
  chatService.update(conversationId, { status: 'working' })
  frames = []
  capture = vi.fn()
})

function sink(extra: Partial<TurnSinkDeps> = {}) {
  return createTurnSink({
    send: (frame) => { frames.push(frame) },
    chatService,
    conversationId,
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    memoryCapture: capture,
    ...extra,
  })
}

function response(usage: ModelUsage, extra: Partial<ModelResponse> = {}): ModelResponse {
  return {
    id: 'r', provider: 'anthropic', model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'the answer' }], stopReason: 'end', usage, ...extra,
  }
}

const assistantMessages = () => chatService.get(conversationId)!.messages.filter((m) => m.role === 'assistant')
const framesOf = <T extends ChatStreamFrame['type']>(type: T) =>
  frames.filter((f): f is Extract<ChatStreamFrame, { type: T }> => f.type === type)
const terminalFrames = () => frames.filter((f) => ['done', 'error', 'cancelled', 'parked_for_approval'].includes(f.type))

describe('turn sink — the reply is persisted exactly once', () => {
  it('(MISSED-R1A-M1) a done with usage 0/0 gives one message, one done frame and one memory capture', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'the answer' })
    s.handle({ type: 'turn_complete', turn: 1, tokensUsed: 0, usage: { inputTokens: 0, outputTokens: 0 } })
    s.handle({ type: 'done', response: response({ inputTokens: 0, outputTokens: 0 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()

    expect(assistantMessages()).toHaveLength(1)
    expect(assistantMessages()[0].content).toBe('the answer')
    expect(framesOf('done')).toHaveLength(1)
    expect(terminalFrames()).toHaveLength(1)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('the answer')
    expect(chatService.get(conversationId)!.status).toBe('idle')
  })

  it('(−) calling finish() twice is a no-op', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'the answer' })
    s.handle({ type: 'done', response: response({ inputTokens: 10, outputTokens: 5 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()
    const costAfterFirst = chatService.get(conversationId)!.totalCostUsd
    await s.finish()
    await s.finish({ error: new Error('late failure') })

    expect(s.finished).toBe(true)
    expect(assistantMessages()).toHaveLength(1)
    expect(terminalFrames()).toHaveLength(1)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(chatService.get(conversationId)!.totalCostUsd).toBe(costAfterFirst)
  })

  it('the done frame carries the stored message with its validated turnMeta', async () => {
    const s = sink()
    s.start({ agentId: 'agent-1', maxTurns: 25, binding: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', source: 'conversation' } })
    s.handle({ type: 'text', text: 'the answer' })
    s.handle({ type: 'turn_complete', turn: 1, tokensUsed: 1_100_000, usage: { inputTokens: 1_000_000, outputTokens: 100_000 } })
    s.handle({ type: 'done', response: response({ inputTokens: 1_000_000, outputTokens: 100_000 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()

    const done = framesOf('done')[0]
    const meta = done.turnMeta
    expect(TurnMetaSchema.safeParse(meta).success).toBe(true)
    const expectedCost = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(meta).toMatchObject({
      outcome: 'completed',
      stopReason: 'end',
      costSource: 'estimate',
      steps: 1,
      binding: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', source: 'conversation' },
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
    })
    expect(meta.usage.costUsd).toBeCloseTo(expectedCost, 6)
    // The stored row carries the same meta and the split token counts.
    const stored = assistantMessages()[0]
    expect(stored.turnMeta).toEqual(meta)
    expect(stored.tokensIn).toBe(1_000_000)
    expect(stored.tokensOut).toBe(100_000)
    expect((done.message as { id: number }).id).toBe(stored.id)
    expect(chatService.get(conversationId)!.totalCostUsd).toBeCloseTo(expectedCost, 6)
    expect(frames[0]).toEqual({
      type: 'agent_start', agentId: 'agent-1', maxTurns: 25,
      binding: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', source: 'conversation' },
    })
  })

  it('a turn the provider priced itself keeps its cost, with costSource provider', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 200_000, outputTokens: 50_000, costUsd: 0.02 }) })
    await s.finish()
    expect(framesOf('done')[0].turnMeta).toMatchObject({ costSource: 'provider', usage: { costUsd: 0.02 } })
    expect(chatService.get(conversationId)!.totalCostUsd).toBeCloseTo(0.02, 6)
  })

  it('(−) a provider that reported no usage shows cost unknown and records no cost, never $0 as a price', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 0, outputTokens: 0, reported: false }) })
    await s.finish()
    const meta = framesOf('done')[0].turnMeta
    expect(meta.costSource).toBe('unknown')
    expect(meta.usage.reported).toBe(false)
    expect(meta.usage).not.toHaveProperty('costUsd')
    expect(chatService.get(conversationId)!.totalCostUsd).toBe(0)
  })

  it('a gateway done (no turn_complete) reports its call as one turn, like the runner does', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 7, outputTokens: 3 }) })
    await s.finish()
    expect(framesOf('turn_complete')).toEqual([{ type: 'turn_complete', turn: 1, tokensUsed: 10 }])
    expect(framesOf('done')[0].turnMeta).toMatchObject({ steps: 1, usage: { inputTokens: 7, outputTokens: 3 } })
  })

  it('a done with no streamed text stores the response text', async () => {
    const s = sink()
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()
    expect(assistantMessages()[0].content).toBe('the answer')
  })
})

describe('turn sink — budget stops are outcomes', () => {
  it('outcome max_turns persists the partial text with turnMeta.outcome, usage and cost (positive)', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'partial so far' })
    s.handle({ type: 'turn_complete', turn: 1, tokensUsed: 150, usage: { inputTokens: 100, outputTokens: 50 } })
    s.handle({ type: 'done', response: response({ inputTokens: 100, outputTokens: 50 }, { stopReason: 'max_turns' }), outcome: 'max_turns', stopReason: 'max_turns' })
    await s.finish()

    const [stored] = assistantMessages()
    expect(stored.content).toBe('partial so far')
    expect(stored.turnMeta).toMatchObject({ outcome: 'max_turns', stopReason: 'max_turns', usage: { inputTokens: 100, outputTokens: 50 }, costSource: 'estimate' })
    expect(stored.turnMeta!.usage.costUsd).toBeGreaterThan(0)
    expect(chatService.get(conversationId)!.totalCostUsd).toBeGreaterThan(0)
    expect(framesOf('error')).toHaveLength(0)
  })

  it('a done without an outcome (older runner fakes) derives it from the stop reason', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'cut' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }, { stopReason: 'max_tokens' }) })
    await s.finish()
    expect(assistantMessages()[0].turnMeta).toMatchObject({ outcome: 'max_tokens', stopReason: 'max_tokens' })
  })
})

describe('turn sink — failures', () => {
  it('a ProviderRunError persists its partialText; the error frame has kind provider-run-error and partialSaved true', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'streamed' })
    await s.finish({ error: new ProviderRunError('error_during_execution', { partialText: 'the partial answer', usage: { inputTokens: 40, outputTokens: 10, costUsd: 0.003 } }) })

    const [stored] = assistantMessages()
    expect(stored.content).toBe('the partial answer')
    expect(stored.turnMeta).toMatchObject({ outcome: 'failed', errorKind: 'provider-run-error', usage: { inputTokens: 40, outputTokens: 10 }, costSource: 'provider' })
    const [error] = framesOf('error')
    expect(error).toMatchObject({ type: 'error', kind: 'provider-run-error', retryable: false, providerId: 'anthropic', partialSaved: true })
    expect(error.detail).toContain('error_during_execution')
    expect(terminalFrames()).toHaveLength(1)
    expect(chatService.get(conversationId)!.totalCostUsd).toBeCloseTo(0.003, 6)
    expect(capture).toHaveBeenCalledWith('the partial answer')
    expect(chatService.get(conversationId)!.status).toBe('idle')
  })

  it('a CodedModelError sends its code and params; with no text no message is stored', async () => {
    const s = sink()
    await s.finish({ error: new CodedModelError('isolation', 'cliIsolation.foreignMcpServer', { server: 'x' }) })

    expect(assistantMessages()).toHaveLength(0)
    expect(framesOf('error')).toEqual([{
      type: 'error', kind: 'isolation', retryable: false, code: 'cliIsolation.foreignMcpServer', params: { server: 'x' },
      providerId: 'anthropic', detail: 'isolation: cliIsolation.foreignMcpServer', partialSaved: false,
    }])
    expect(capture).not.toHaveBeenCalled()
  })

  it('(−) a 401-shaped error gives kind auth and no code', async () => {
    const s = sink()
    await s.finish({ error: Object.assign(new Error('Unauthorized'), { status: 401 }) })
    const [error] = framesOf('error')
    expect(error.kind).toBe('auth')
    expect(error).not.toHaveProperty('code')
  })

  it('a gateway error frame is the failure (the direct-stream branch)', async () => {
    const s = sink()
    s.handle({ type: 'text', text: 'half' })
    s.handle({ type: 'error', error: new Error('socket hang up') })
    await s.finish()
    expect(framesOf('error')).toHaveLength(1)
    expect(framesOf('error')[0]).toMatchObject({ kind: 'network', retryable: true, partialSaved: true })
    // Error text is never stored as content: only the partial answer.
    expect(assistantMessages()[0].content).toBe('half')
    expect(assistantMessages()[0].turnMeta).toMatchObject({ outcome: 'failed', errorKind: 'network' })
  })

  it('(−) a stream that ends without any terminal is a failure, never a silent success', async () => {
    const s = sink()
    await s.finish()
    expect(framesOf('error')).toHaveLength(1)
    expect(framesOf('done')).toHaveLength(0)
    expect(assistantMessages()).toHaveLength(0)
  })
})

describe('turn sink — cancel and park', () => {
  it('cancel with partial text persists outcome cancelled and sends a single cancelled frame', async () => {
    const controller = new AbortController()
    const s = sink({ signal: controller.signal })
    s.handle({ type: 'text', text: 'so far' })
    controller.abort()
    s.handle({ type: 'cancelled', reason: 'run aborted' })
    await s.finish()

    expect(framesOf('cancelled')).toEqual([{ type: 'cancelled', reason: 'run aborted' }])
    expect(terminalFrames()).toHaveLength(1)
    expect(assistantMessages()[0]).toMatchObject({ content: 'so far', turnMeta: { outcome: 'cancelled' } })
    expect(chatService.get(conversationId)!.status).toBe('idle')
  })

  it('(−) the abort error of a cancelled run is not reported as a failure', async () => {
    const controller = new AbortController()
    const s = sink({ signal: controller.signal })
    controller.abort()
    await s.finish({ error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) })
    expect(framesOf('error')).toHaveLength(0)
    expect(framesOf('cancelled')).toHaveLength(1)
    expect(assistantMessages()).toHaveLength(0)
  })

  it('a parked run sends parked_for_approval and leaves the conversation waiting for approval', async () => {
    const s = sink()
    s.handle({ type: 'parked_for_approval', approvalId: 7, toolName: 'run_command' })
    await s.finish()
    expect(framesOf('parked_for_approval')).toEqual([{ type: 'parked_for_approval', approvalId: 7, toolName: 'run_command' }])
    expect(chatService.get(conversationId)!.status).toBe('waiting_approval')
  })
})

describe('turn sink — frames, notices and annotations', () => {
  it('maps tool rows, approvals and steps, and counts them into turnMeta', async () => {
    const s = sink()
    s.start({ agentId: null, maxTurns: 12 })
    s.handle({ type: 'tool_use_start', id: 'c1', name: 'run_command', rawName: 'Bash', input: { command: 'ls' } })
    s.handle({ type: 'tool_use_start', id: 'c1', name: 'run_command', input: { command: 'ls' } })
    s.handle({ type: 'tool_result', toolUseId: 'c1', content: 'a.txt', isError: false, durationMs: 4, outcome: 'success', executedBy: 'provider' })
    s.handle({ type: 'step', n: 1 })
    s.handle({ type: 'step', n: 2 })
    s.handle({ type: 'approval_required', toolUseId: 'c2', toolName: 'run_command', reason: 'needs a human', approvalId: 5 })
    s.handle({ type: 'tool_result', toolUseId: 'c2', content: 'denied', isError: true, durationMs: 0, outcome: 'denied' })
    s.handle({ type: 'text', text: 'done' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()

    expect(frames).toContainEqual({ type: 'tool_use', id: 'c1', name: 'run_command', rawName: 'Bash', input: { command: 'ls' } })
    expect(frames).toContainEqual({ type: 'tool_result', toolUseId: 'c1', output: 'a.txt', durationMs: 4, outcome: 'success', executedBy: 'provider' })
    expect(frames).toContainEqual({ type: 'tool_result', toolUseId: 'c2', output: 'denied', error: 'denied', durationMs: 0, outcome: 'denied' })
    expect(frames).toContainEqual({ type: 'approval_required', toolUseId: 'c2', toolName: 'run_command', reason: 'needs a human', approvalId: 5 })
    expect(framesOf('progress')).toEqual([{ type: 'progress', step: 1, maxSteps: 12 }, { type: 'progress', step: 2, maxSteps: 12 }])
    expect(framesOf('done')[0].turnMeta).toMatchObject({ steps: 2, toolCalls: 1, approvals: 1 })
  })

  it('notice(imagesNotVisible) sends one notice frame and records it in turnMeta.notices', async () => {
    const s = sink()
    s.notice('imagesNotVisible', { count: 2 })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    expect(framesOf('notice')).toEqual([{ type: 'notice', code: 'imagesNotVisible', params: { count: 2 } }])
    expect(assistantMessages()[0].turnMeta!.notices).toEqual([{ code: 'imagesNotVisible', params: { count: 2 } }])
  })

  it('(−) a contextCompacted notice is shown and recorded, and writes no memory of its own', async () => {
    const s = sink()
    s.handle({ type: 'notice', code: 'contextCompacted' })
    s.handle({ type: 'text', text: 'the reply' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    expect(framesOf('notice')).toEqual([{ type: 'notice', code: 'contextCompacted' }])
    expect(assistantMessages()[0].turnMeta!.notices).toEqual([{ code: 'contextCompacted' }])
    // The only memory write is the post-turn capture of the reply itself.
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('the reply')
  })

  it('(−) an unknown notice code is dropped, not sent', () => {
    const s = sink()
    s.notice('notARealCode' as never)
    expect(framesOf('notice')).toHaveLength(0)
  })

  it('annotate() records a valid effort and ignores a malformed one', async () => {
    const s = sink()
    s.annotate({ effort: { requested: 'high', effective: 'medium', clamped: true } })
    s.annotate({ effort: { requested: 'ultra', effective: 'high' } } as unknown as Parameters<typeof s.annotate>[0])
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    const meta: TurnMeta = framesOf('done')[0].turnMeta
    expect(meta.effort).toEqual({ requested: 'high', effective: 'medium', clamped: true })
  })

  it('runs the attachment collectors once and hangs their documents off the reply', async () => {
    const collect = vi.fn().mockResolvedValue(['doc-1'])
    const s = sink({ collectAttachments: collect })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    await s.finish()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(assistantMessages()[0].attachmentIds).toEqual(['doc-1'])
  })

  it('observes the measured prompt size and window once, when the provider reported them', async () => {
    const observe = vi.fn()
    const s = sink({ observe })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1, promptTokensLastCall: 4200 }, { contextWindow: 1_000_000 }) })
    await s.finish()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith({ promptTokens: 4200, contextWindow: 1_000_000 })
  })

  it('(G11) observes BEFORE the done frame, so the frame\'s occupancy already reads the measurement', async () => {
    const order: string[] = []
    const s = sink({
      observe: () => { order.push('observe') },
      conversationPayload: () => { order.push('payload'); return { measured: true } },
      send: (frame) => { frames.push(frame); if (frame.type === 'done') order.push('done') },
    })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'turn_complete', turn: 1, tokensUsed: 2, usage: { inputTokens: 1, outputTokens: 1, promptTokensLastCall: 900 } })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }), outcome: 'completed', stopReason: 'end' })
    await s.finish()
    expect(order).toEqual(['observe', 'payload', 'done'])
  })

  it('(I12) observes how an ACP CLI got the system prompt, even with nothing else measured', async () => {
    const observe = vi.fn()
    const s = sink({ observe })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }, { systemPromptChannel: 'meta-verified' }) })
    await s.finish()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith({ systemPromptChannel: 'meta-verified' })
  })

  it('(−) nothing measured: no observation (the estimate stands)', async () => {
    const observe = vi.fn()
    const s = sink({ observe })
    s.handle({ type: 'text', text: 'x' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    expect(observe).not.toHaveBeenCalled()
  })

  it('(−) a client that went away does not stop the reply from being stored', async () => {
    const s = createTurnSink({
      send: () => { throw new Error('stream closed') },
      chatService, conversationId, providerId: 'anthropic', modelId: 'claude-sonnet-4-6',
    })
    s.handle({ type: 'text', text: 'kept' })
    s.handle({ type: 'done', response: response({ inputTokens: 1, outputTokens: 1 }) })
    await s.finish()
    expect(assistantMessages()[0].content).toBe('kept')
  })
})
