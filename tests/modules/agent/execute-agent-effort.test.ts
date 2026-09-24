// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E4 — executeAgent (delegation, specialist, pipeline) sends the effort
// intent the one loader resolves from the stored rows (effort-intent.ts):
// the conversation's own level, else Deep → Max, else the specialist's own
// effort, else the delegating conversation's (inherited). The reply records
// requested vs effective from the run's final response (TurnMeta.effort).
// Fictive agents and conversations.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TurnMetaSchema } from '@shared/chat-stream.js'

const runCalls: any[] = []
let effortOutcome: unknown

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({
    run: (options: any) => {
      runCalls.push(options)
      return (async function* () {
        yield { type: 'text', text: 'answer' }
        yield {
          type: 'done',
          response: { content: [{ type: 'text', text: 'answer' }], ...(effortOutcome ? { effortOutcome } : {}) },
          outcome: 'completed',
          stopReason: 'end',
        }
      })()
    },
  }),
}))

import { agentModule } from '@modules/agent/index'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function boot(): Promise<{ ctx: any; conversations: ConversationService }> {
  const db = await createProductionConversationsDb()
  const ctx: any = {
    db,
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  const conversations = createConversationService(db)
  ctx.conversations = conversations
  return { ctx, conversations }
}

function agent(ctx: any, id: string, effort?: string) {
  ctx.agents.registry.create({
    id, name: id, role: 'specialist', description: 'd', goal: 'g', backstory: 'b',
    systemPrompt: 'sp', capabilities: [], tools: [], constraints: [],
    ...(effort ? { effort } : {}),
  })
}

/** A delegating conversation with the given settings, and its child for `agentId`. */
function delegation(conversations: ConversationService, agentId: string, parent: { effort?: string; orchestration?: string }) {
  const lead = conversations.create({ userId: 'u1' })
  conversations.update(lead.id, parent as any)
  const child = conversations.createSubConversation({ title: 'sub', goalDescription: 'task', parentConversationId: lead.id, agentId })
  return child.id
}

const reply = (conversations: ConversationService, id: string) =>
  conversations.get(id)!.messages.filter((m) => m.role === 'assistant').at(-1)!

describe('executeAgent — effort intent (E4)', () => {
  beforeEach(() => {
    runCalls.length = 0
    effortOutcome = undefined
  })

  it('(+) a delegation child inherits the parent\'s explicit level when the specialist has none', async () => {
    const { ctx, conversations } = await boot()
    agent(ctx, 'plain')
    const child = delegation(conversations, 'plain', { effort: 'xhigh' })
    await ctx.agents.executeAgent(child, 'plain', 'task')
    expect(runCalls[0].effort).toEqual({ level: 'xhigh', source: 'inherited' })
  })

  it('(+) the specialist\'s own effort wins over the parent\'s level', async () => {
    const { ctx, conversations } = await boot()
    agent(ctx, 'careful', 'low')
    const child = delegation(conversations, 'careful', { effort: 'xhigh' })
    await ctx.agents.executeAgent(child, 'careful', 'task')
    expect(runCalls[0].effort).toEqual({ level: 'low', source: 'agent' })
  })

  it('(+) the pipeline origin resolves the same way; a Deep parent hands down Max', async () => {
    const { ctx, conversations } = await boot()
    agent(ctx, 'stage')
    const child = delegation(conversations, 'stage', { orchestration: 'deep' })
    await ctx.agents.executeAgent(child, 'stage', 'task', { origin: 'pipeline' })
    expect(runCalls[0].metadata.origin).toBe('pipeline')
    expect(runCalls[0].effort).toEqual({ level: 'max', source: 'inherited' })
  })

  it('(+) the reply records requested vs effective from the run\'s final response', async () => {
    const { ctx, conversations } = await boot()
    agent(ctx, 'careful', 'xhigh')
    const child = delegation(conversations, 'careful', {})
    effortOutcome = { requested: 'xhigh', effective: 'high', source: 'agent', clamped: true, reason: 'unsupported' }
    await ctx.agents.executeAgent(child, 'careful', 'task')
    const stored = reply(conversations, child)
    expect(stored.turnMeta?.effort).toEqual({ requested: 'xhigh', effective: 'high', source: 'agent', clamped: true })
    expect(TurnMetaSchema.safeParse(stored.turnMeta).success).toBe(true)
  })

  it('(−) nothing set anywhere: no intent, and an unusable outcome records no effort', async () => {
    const { ctx, conversations } = await boot()
    agent(ctx, 'plain')
    const child = delegation(conversations, 'plain', {})
    effortOutcome = { requested: 'high', effective: 'high', source: 'guess', clamped: false }
    await ctx.agents.executeAgent(child, 'plain', 'task')
    expect(runCalls[0].effort).toBeUndefined()
    const stored = reply(conversations, child)
    expect(stored.turnMeta).toBeDefined()
    expect(stored.turnMeta).not.toHaveProperty('effort')
  })
})
