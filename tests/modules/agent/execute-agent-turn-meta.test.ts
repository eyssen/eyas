// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G7 — executeAgent (delegation, specialist, pipeline) stores how the run
// ended with its assistant message: the same TurnMeta the chat route writes,
// validated against the strict schema (an invalid one would be refused).

import { describe, it, expect, vi } from 'vitest'
import { TurnMetaSchema } from '@shared/chat-stream.js'
import { ProviderRunError } from '@shared/classify-model-error.js'

let nextRun: () => AsyncGenerator<any>

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({ run: () => nextRun() }),
}))

import { agentModule } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function boot() {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  ctx.conversations = { get: vi.fn().mockReturnValue(null), addMessage: vi.fn(), addRunCost: vi.fn() }
  return ctx
}

const assistantCall = (ctx: any) =>
  ctx.conversations.addMessage.mock.calls.map((c: any[]) => c[1]).find((m: any) => m.role === 'assistant')

describe('executeAgent — TurnMeta with the reply', () => {
  it('(+) a turn-cap stop keeps the partial answer with outcome max_turns and the run\'s usage', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'partial' }
      yield { type: 'turn_complete', turn: 1, tokensUsed: 15, usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'done', response: { content: [] }, outcome: 'max_turns', stopReason: 'max_turns' }
    })()
    const ctx = await boot()
    const result = await ctx.agents.executeAgent('conv-1', 'researcher', 'dig')
    expect(result.status).toBe('max_turns')
    const reply = assistantCall(ctx)
    expect(reply.content).toBe('partial')
    expect(TurnMetaSchema.safeParse(reply.turnMeta).success).toBe(true)
    expect(reply.turnMeta).toMatchObject({ outcome: 'max_turns', stopReason: 'max_turns', usage: { inputTokens: 10, outputTokens: 5 }, costSource: 'estimate' })
  })

  it('(+) a completed run is stored with outcome completed', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'done it' }
      yield { type: 'done', response: { content: [] }, outcome: 'completed', stopReason: 'end' }
    })()
    const ctx = await boot()
    await ctx.agents.executeAgent('conv-2', 'researcher', 'dig')
    expect(assistantCall(ctx).turnMeta).toMatchObject({ outcome: 'completed', stopReason: 'end' })
  })

  it('(−) a failed run stores only its partial answer, as failed with its error kind — never the error text', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'streamed' }
      throw new ProviderRunError('error_during_execution', { partialText: 'what it had' })
    })()
    const ctx = await boot()
    const result = await ctx.agents.executeAgent('conv-3', 'researcher', 'dig')
    expect(result.status).toBe('failed')
    const reply = assistantCall(ctx)
    expect(reply.content).toBe('what it had')
    expect(reply.turnMeta).toMatchObject({ outcome: 'failed', errorKind: 'provider-run-error' })
  })
})
