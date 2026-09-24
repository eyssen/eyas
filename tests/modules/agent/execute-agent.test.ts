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
import { createBindingResolver, type ModelPair } from '@modules/model/binding'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'

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

  it("returns status max_turns (not completed/failed) when the runner's done terminal says max_turns, keeping whatever text streamed", async () => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'partial output before the cap' }
      yield { type: 'done', response: { content: [{ type: 'text', text: 'partial output before the cap' }] }, outcome: 'max_turns', stopReason: 'max_turns' }
    })()
    const ctx = await bootAgentModule()

    const result = await ctx.agents.executeAgent('conv-mt', 'researcher', 'find the bug')

    expect(result.status).toBe('max_turns')
    expect(result.text).toBe('partial output before the cap')

    const row = (ctx.db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'conv-mt'`) as any[])[0]
    expect(row.status).toBe('max_turns')
  })

  it("an early stop that is not the turn cap (tool budget, refusal) keeps the 'completed' status and row", async () => {
    for (const outcome of ['tool_budget', 'refusal'] as const) {
      nextRun = () => (async function* () {
        yield { type: 'text', text: `stopped on ${outcome}` }
        yield { type: 'done', response: { content: [] }, outcome, stopReason: outcome === 'refusal' ? 'refusal' : 'tool_use' }
      })()
      const ctx = await bootAgentModule()
      const conv = `conv-${outcome}`
      const result = await ctx.agents.executeAgent(conv, 'researcher', 'find the bug')
      expect(result.status).toBe('completed')
      expect(result.text).toBe(`stopped on ${outcome}`)
      const row = (ctx.db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = ${conv}`) as any[])[0]
      expect(row.status).toBe('completed')
    }
  })

  it('catches a thrown ProviderRunError, finalizes the run as failed, and surfaces partialText instead of propagating', async () => {
    nextRun = () => (async function* () {
      throw new ProviderRunError('error_max_turns', { partialText: 'what the model got out before dying' })
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
    // F0 — executeAgent assembles the system prompt before it starts the run,
    // so runner.run() is no longer reached in the caller's tick. Yield until
    // the run has actually been registered before reaching for its session id.
    for (let i = 0; runCalls.length === 0 && i < 50; i++) await Promise.resolve()
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

describe('executeAgent — model binding (H4)', () => {
  /** A resolver over a fixed catalog: `models` lists each active provider's enabled models. */
  function catalogResolver(models: Record<string, string[]>, defaultPair: ModelPair | null) {
    return createBindingResolver({
      isProviderActive: (id) => id in models,
      modelState: (p, m) => (models[p]?.includes(m) ? 'enabled' : 'unknown'),
      resolveModelRef: (m) => {
        const owners = Object.entries(models).filter(([, ids]) => ids.includes(m))
        return owners.length === 1 ? { providerId: owners[0][0], modelId: m } : null
      },
      resolveForTier: () => null,
      route: async () => { throw new Error('no triage') },
      autoRoutingEnabled: () => false,
      resolveDefault: () => defaultPair,
    })
  }

  const CATALOG = {
    'claude-code': ['claude-code-sonnet'],
    'grok-cli': ['grok-cli-default'],
  }
  const TURN = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }

  async function boot(resolver: ReturnType<typeof catalogResolver>) {
    const conversations = createConversationService(await createProductionConversationsDb())
    const ctx: any = {
      db: createMemoryDb(),
      bus: { emit: () => {}, on: () => {}, off: () => {} },
      logger: silentLogger,
      model: {},
      permissions: { registerSubject: () => {} },
      hasModule: () => false,
      http: { get: () => {}, post: () => {}, use: () => {} },
      conversations,
      modelBinding: resolver,
    }
    await agentModule.onRegister!(ctx)
    const parent = conversations.create({ userId: 'u1', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    return { ctx, conversations, parent }
  }

  function specialist(ctx: any, over: { provider?: string; model?: string } = {}) {
    ctx.agents.registry.create({
      id: 'spec', name: 'Spec', role: 'r', description: 'd', goal: 'g', backstory: 'b', tier: 'specialist',
      systemPrompt: 'You check things.', capabilities: [], tools: [], constraints: [], ...over,
    })
  }

  beforeEach(() => {
    runCalls.length = 0
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'done' }
      yield { type: 'done', response: { content: [{ type: 'text', text: 'done' }] } }
    })()
  })

  it("(+) a specialist without a model runs on the delegating turn's binding, stored on its sub-conversation", async () => {
    const { ctx, conversations, parent } = await boot(catalogResolver(CATALOG, { providerId: 'grok-cli', modelId: 'grok-cli-default' }))
    specialist(ctx)

    const out = await ctx.agents.delegation.delegate(parent.id, 'spec', 'check it', { binding: TURN })

    // Not the parent's raw grok-cli pair, not the install default: the turn's.
    expect(runCalls[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    const child = conversations.get(out.conversationId)!
    expect(child).toMatchObject({ modelBinding: 'inherit', providerId: 'claude-code', modelId: 'claude-code-sonnet' })
    // Both the task and the reply record the pair that ran, with the rule that picked it.
    const reply = child.messages.find((m) => m.role === 'assistant')!
    expect(reply).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect(reply.turnMeta?.binding).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'parent' })
  })

  it("(+) the specialist's own provider+model wins over the delegating turn's", async () => {
    const { ctx, parent } = await boot(catalogResolver(CATALOG, null))
    specialist(ctx, { provider: 'grok-cli', model: 'grok-cli-default' })
    await ctx.agents.delegation.delegate(parent.id, 'spec', 'check it', { binding: TURN })
    expect(runCalls[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
  })

  it("(−) a specialist pair on a disabled provider runs on the stored pair with a note — never 'anthropic'", async () => {
    const { ctx, conversations, parent } = await boot(catalogResolver(CATALOG, null))
    specialist(ctx, { provider: 'anthropic', model: 'claude-sonnet-4-6' })

    const out = await ctx.agents.delegation.delegate(parent.id, 'spec', 'check it', { binding: TURN })

    expect(runCalls[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect(runCalls[0].provider).not.toBe('anthropic')
    const reply = conversations.get(out.conversationId)!.messages.find((m) => m.role === 'assistant')!
    expect(reply.turnMeta?.binding).toMatchObject({ providerId: 'claude-code', source: 'parent', note: 'agent-binding-unavailable' })
  })

  it('(+) no turn binding and no model: the install default, fixed on the sub-conversation', async () => {
    const { ctx, conversations, parent } = await boot(catalogResolver(CATALOG, { providerId: 'grok-cli', modelId: 'grok-cli-default' }))
    specialist(ctx)
    const out = await ctx.agents.delegation.delegate(parent.id, 'spec', 'check it')
    expect(runCalls[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    expect(conversations.get(out.conversationId)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
  })

  it('(−) nothing configured: the run fails with the coded error, no model is called', async () => {
    const { ctx, parent } = await boot(catalogResolver({}, null))
    specialist(ctx)
    const out = await ctx.agents.delegation.delegate(parent.id, 'spec', 'check it')
    expect(runCalls).toHaveLength(0)
    expect(out.result).toMatch(/did not complete \(status: failed\)/)
  })
})
