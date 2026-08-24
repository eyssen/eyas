// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T4 — executeAgent (agent/index.ts) is now SUPERVISED (kind='delegation':
// an agent_sessions row + checkpoint/event-store capture) and returns an
// HONEST result — { text, status, sessionId } — instead of always resolving
// as a plain string with a fabricated 'Task completed.' fallback on empty
// output. A thrown provider error is caught and translated into
// status:'failed' (surfacing ProviderRunError.partialText when available)
// rather than propagating, so callers always get a shapely result to inspect.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { ProviderRunError } from '@shared/classify-model-error'

const runCalls: any[] = []
let nextRun: () => AsyncGenerator<any>

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({
    run: (options: any) => {
      runCalls.push(options)
      return nextRun()
    },
  }),
}))

import { agentModule } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function bootAgentModule(overrides: { logger?: any } = {}) {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: overrides.logger ?? silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  return ctx
}

describe('executeAgent — supervision + honest result (F2 T4)', () => {
  beforeEach(() => {
    runCalls.length = 0
  })

  it('creates a supervised agent_sessions row (kind=delegation) and returns the accumulated text with status completed', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'hello ' }
      yield { type: 'text', text: 'world' }
      yield { type: 'done', response: { content: [{ type: 'text', text: 'hello world' }] } }
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-1', 'researcher', 'find the bug')

    expect(result.status).toBe('completed')
    expect(result.text).toBe('hello world')
    expect(typeof result.sessionId).toBe('string')
    expect(result.sessionId.length).toBeGreaterThan(0)

    const rows = ctx.db.all(sql`SELECT * FROM agent_sessions WHERE conversation_id = 'conv-1'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('delegation')
    expect(rows[0].status).toBe('completed')
    expect(rows[0].id).toBe(result.sessionId)

    // sessionId (Cap 3 correlation id) was threaded into the runner call.
    expect(runCalls[0].sessionId).toBe(result.sessionId)
  })

  it('returns empty text (NOT the old fabricated "Task completed.") when the model produced no text', async () => {
    nextRun = () => (async function* () {
      yield { type: 'tool_use_start', id: 't1', name: 'search_memory' }
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-empty', 'researcher', 'find the bug')

    expect(result.text).toBe('')
    expect(result.status).toBe('completed')
  })

  it('returns status max_turns (not completed/failed) when the runner signals max_turns_reached, keeping whatever text streamed', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'partial output before the cap' }
      yield { type: 'max_turns_reached', turns: 10 }
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-mt', 'researcher', 'find the bug')

    expect(result.status).toBe('max_turns')
    expect(result.text).toBe('partial output before the cap')

    const row = (ctx.db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'conv-mt'`) as any[])[0]
    expect(row.status).toBe('max_turns')
  })

  it('catches a thrown ProviderRunError, finalizes the run as failed, and surfaces partialText instead of propagating', async () => {
    nextRun = () => (async function* () {
      throw new ProviderRunError('error_max_turns', { partialText: 'what the model got out before dying', sessionId: null })
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-fail', 'researcher', 'find the bug')

    expect(result.status).toBe('failed')
    expect(result.text).toBe('what the model got out before dying')

    const row = (ctx.db.all(sql`SELECT status, error FROM agent_sessions WHERE conversation_id = 'conv-fail'`) as any[])[0]
    expect(row.status).toBe('failed')
    expect(row.error).toContain('error_max_turns')
  })

  it('catches a plain throw and falls back to whatever text streamed before the failure', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'streamed before crash' }
      throw new Error('gateway exploded')
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-crash', 'researcher', 'find the bug')

    expect(result.status).toBe('failed')
    expect(result.text).toBe('streamed before crash')
  })

  // Fix round 1 / Critical 1 — an aborted/stuck run (now reachable
  // AUTOMATICALLY via the scheduled stuck sweep, or an operator cancel) must
  // not read as 'completed': the generator returns normally after yielding
  // 'cancelled' (no throw), so the loop has to observe that event itself.
  it('treats an aborted/stuck run (cancelled) as failed — not completed — matching the honest DB status', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((r) => { releaseGate = r })
    nextRun = () => {
      const opts = runCalls[runCalls.length - 1]
      return (async function* () {
        yield { type: 'text', text: 'partial before abort' }
        await gate
        if (opts.signal?.aborted) {
          yield { type: 'cancelled', reason: 'run aborted' }
          return
        }
        yield { type: 'done', response: { content: [{ type: 'text', text: 'should not reach here' }] } }
      })()
    }
    const ctx = await bootAgentModule()

    const resultPromise = ctx.agents.executeAgent('conv-cancel', 'researcher', 'find the bug')
    const sessionId = runCalls[0].sessionId
    expect(sessionId).toBeTruthy()
    expect(ctx.agents.supervisor.cancel(sessionId)).toBe(true)
    releaseGate()

    const result = await resultPromise

    expect(result.status).toBe('failed')
    expect(result.text).toBe('partial before abort')

    const row = (ctx.db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'conv-cancel'`) as any[])[0]
    expect(row.status).toBe('cancelled')
  })

  // F2 T5 — a delegated/pipeline run that escalated is PARKED: it neither
  // completed nor failed, its row stays open (no completed_at) for Task 6 to
  // resume, and the caller learns which approval is blocking it.
  it('returns status parked with the approval id and leaves the run row waiting_approval', async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'got this far' }
      yield { type: 'parked_for_approval', approvalId: 17, toolName: 'run_command' }
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-parked', 'researcher', 'find the bug')

    expect(result.status).toBe('parked')
    expect(result.approvalId).toBe(17)
    expect(result.text).toBe('got this far')

    const row = (ctx.db.all(sql`SELECT status, completed_at FROM agent_sessions WHERE conversation_id = 'conv-parked'`) as any[])[0]
    expect(row.status).toBe('waiting_approval')
    expect(row.completed_at).toBeNull()
  })

  // Fix round 1 / Important 3 — the catch block called handle.fail(...) but
  // logged nothing, silently swallowing the provider error (conversation-
  // runner.ts's equivalent path logs it).
  it('logs the failure (with sessionId + conversationId context) instead of swallowing it silently', async () => {
    const errorCalls: any[] = []
    const spyLogger = { ...silentLogger, error: (...args: any[]) => { errorCalls.push(args) } }
    nextRun = () => (async function* () { throw new Error('gateway exploded') })()
    const ctx = await bootAgentModule({ logger: spyLogger })

    const result = await ctx.agents.executeAgent('conv-logged', 'researcher', 'find the bug')

    expect(result.status).toBe('failed')
    expect(errorCalls).toHaveLength(1)
    const [meta, msg] = errorCalls[0]
    expect(String(msg)).toMatch(/executeAgent/i)
    expect(meta).toMatchObject({ sessionId: result.sessionId, conversationId: 'conv-logged', agentId: 'researcher' })
  })
})
