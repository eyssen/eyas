// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createMemoryDb, createTestDb } from '../../helpers/test-db'
import { createRunConversationEntry, createRunDeps } from '@modules/agent/run-deps'
import { agentModule } from '@modules/agent/index'

/** createRunDeps (I10): the one bundle every background run shares. */

const silent: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => silent }

function bundle(ctx: any) {
  return createRunDeps({
    ctx,
    agentRunner: { run: vi.fn() },
    agentRegistry: { get: vi.fn() },
    supervisor: undefined,
    critic: { enabled: false, aux: undefined },
    verify: { commands: [], cwd: '' },
    budgetEngine: undefined,
    getCheckpoint: () => ({ api: {} as any }),
  })
}

describe('createRunDeps', () => {
  it('(+) reads services other modules publish later, per access', async () => {
    const ctx: any = { db: createMemoryDb(), logger: silent, config: {} }
    const deps = bundle(ctx)

    // Published after the bundle was built (module start order is not guaranteed).
    const assembler = { buildForPrimary: vi.fn() }
    const designs = { linkedTo: vi.fn() }
    const documents = { list: vi.fn() }
    const capture = vi.fn(async () => {})
    const events = { append: vi.fn() }
    const recorder = { record: vi.fn() }
    const binding = { resolve: vi.fn() }
    const registry = { toToolDefinitions: vi.fn() }
    Object.assign(ctx, {
      promptAssembler: assembler, designs, documents, memoryCapture: capture,
      eventStore: { events }, contextRecorder: recorder, modelBinding: binding,
      tools: { registry }, config: { model: { pricing: { m: { input: 1, output: 2 } } } },
      conversations: { materializeBinding: vi.fn(() => ({ providerId: 'p', modelId: 'm' })) },
    })

    expect(deps.promptAssembler).toBe(assembler)
    expect(deps.getDesigns?.()).toBe(designs)
    expect(deps.getDocuments?.()).toBe(documents)
    expect(deps.eventStore).toBe(events)
    expect(deps.contextRecorder).toBe(recorder)
    expect(deps.modelBinding).toBe(binding)
    expect(deps.toolRegistry).toBe(registry)
    expect(deps.pricingOverrides).toEqual({ m: { input: 1, output: 2 } })
    expect(deps.materializeBinding?.('c1', { providerId: 'p', modelId: 'm' })).toEqual({ providerId: 'p', modelId: 'm' })
    expect(ctx.conversations.materializeBinding).toHaveBeenCalledWith('c1', 'p', 'm')
    await deps.memoryCapture?.({ conversationId: 'c1', projectId: null, userMessage: 'u', assistantMessage: 'a' } as any)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('(−) a build without the memory, design or conversations module still runs', async () => {
    const deps = bundle({ db: createMemoryDb(), logger: silent, config: {} })

    await expect(deps.memoryCapture?.({ conversationId: 'c1' } as any)).resolves.toBeUndefined()
    expect(deps.getDesigns?.()).toBeUndefined()
    expect(deps.promptAssembler).toBeUndefined()
    expect(deps.materializeBinding?.('c1', { providerId: 'p', modelId: 'm' })).toBeNull()
  })

  it('(−) the entry reports a missing conversation instead of throwing', async () => {
    const db = createMemoryDb()
    const { sql } = await import('drizzle-orm')
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, model_binding TEXT, model_user_chosen INTEGER, parent_conversation_id TEXT, team_session_id TEXT, effort TEXT, orchestration TEXT, working_directories TEXT)`)
    const entry = createRunConversationEntry(bundle({ db, logger: silent, config: {} }))
    await expect(entry('nope')).resolves.toEqual({ ran: false, reason: 'not_found' })
  })
})

describe('agent module publishes the shared entry', () => {
  it('(+) ctx.agents.runConversation and ctx.agents.runDeps exist after register', async () => {
    const ctx: any = {
      db: createTestDb('run-deps').open(),
      bus: { emit: () => {}, on: () => ({ unsubscribe() {} }), off: () => {} },
      logger: silent,
      model: {},
      config: {},
      permissions: { registerSubject: () => {} },
      hasModule: () => false,
      http: { get: () => {}, post: () => {}, use: () => {} },
    }
    await agentModule.onRegister!(ctx)

    expect(typeof ctx.agents.runConversation).toBe('function')
    expect(ctx.agents.runDeps.agentRunner).toBe(ctx.agents.runner)
    expect(ctx.agents.runDeps.agentRegistry).toBe(ctx.agents.registry)
    expect(ctx.agents.runDeps.supervisor).toBe(ctx.agents.supervisor)
    expect(ctx.agents.runDeps.critic).toBe(ctx.agents.critic)
    await expect(ctx.agents.runConversation('missing')).resolves.toEqual({ ran: false, reason: 'not_found' })
  })
})
