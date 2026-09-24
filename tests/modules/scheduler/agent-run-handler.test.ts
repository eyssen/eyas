// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import { runConversation } from '@modules/agent/conversation-runner'
import type { RunConversationEntry } from '@modules/agent/run-deps'
import { AgentRunConfigSchema, createAgentRunHandler, parseAgentRunConfig } from '@modules/scheduler/agent-run-handler'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { JobFailure } from '@modules/scheduler/types'

/**
 * Scheduled agent_run (I10): the job creates a conversation owned by its
 * creator with the prompt as goal and runs it through the shared runner
 * entry — the same run a board card or a hand-off gets.
 */

const testDb = createTestDb('agent-run-handler')
let db: ReturnType<typeof testDb.open>
let conversations: ReturnType<typeof createConversationService>
let agents: ReturnType<typeof createAgentRegistry>
let agentRunner: { run: ReturnType<typeof vi.fn> }
let buildForPrimary: ReturnType<typeof vi.fn>
let runEntry: ReturnType<typeof vi.fn>
let logger: any

const OWNER = 'user-owner'
const MEMBER = 'user-member'

function asyncEvents(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

function insertUser(id: string, rootOwner: boolean): void {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO users (id, username, display_name, role, is_root_owner, created_at, updated_at)
    VALUES (${id}, ${id}, ${id}, ${rootOwner ? 'owner' : 'user'}, ${rootOwner ? 1 : 0}, ${now}, ${now})`)
}

function handler(overrides: { agents?: unknown; conversations?: unknown } = {}) {
  return createAgentRunHandler({
    db,
    logger,
    getAgents: () => ('agents' in overrides ? overrides.agents : { registry: agents, runConversation: runEntry }) as any,
    getConversations: () => ('conversations' in overrides ? overrides.conversations : conversations) as any,
  })
}

function conversationCount(): number {
  return Number((db.all(sql`SELECT COUNT(*) AS n FROM conversations`) as any[])[0].n)
}

beforeEach(() => {
  db = testDb.open()
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  insertUser(OWNER, true)
  insertUser(MEMBER, false)
  conversations = createConversationService(db)
  agents = createAgentRegistry(db)
  agents.create({
    id: 'reporter', name: 'Reporter', role: 'reporter', description: 'reports', goal: 'report', backstory: '',
    systemPrompt: 'You report', capabilities: [], tools: [], constraints: [], maxTurns: 5,
  })
  agentRunner = { run: vi.fn().mockReturnValue(asyncEvents([{ type: 'turn_complete', tokensUsed: 10 }])) }
  buildForPrimary = vi.fn(async () => ({ prefix: 'P', suffix: '', reminders: [], sections: [], prefixHash: 'h', turn: 'T' }))
  // Production: ctx.agents.runConversation (agent/run-deps.ts).
  const entry: RunConversationEntry = (id, o) => runConversation(id, {
    db,
    agentRunner,
    agentRegistry: agents,
    toolRegistry: { toToolDefinitions: () => [] },
    logger,
    promptAssembler: { buildForPrimary } as any,
  }, o)
  runEntry = vi.fn(entry)
})

describe('scheduler agent_run handler (I10)', () => {
  it('(+) creates the conversation for the job creator with the prompt as goal, and runs it', async () => {
    const out = await handler()({ agentId: 'reporter', prompt: 'Summarise yesterday’s tickets' }, { jobId: 'job-1', createdBy: MEMBER }) as any

    expect(out).toMatchObject({ agentId: 'reporter', ran: true })
    const conv = conversations.get(out.conversationId)!
    expect(conv).toMatchObject({
      userId: MEMBER,
      agentId: 'reporter',
      goalDescription: 'Summarise yesterday’s tickets',
      mode: 'autonomous',
      modelBinding: 'inherit',
      status: 'idle', // the run finished and released it
    })
    expect(conv.title).toContain('Scheduled:')
    expect(runEntry).toHaveBeenCalledWith(out.conversationId)
    // The run is the shared background run: the goal is its message and its recall query.
    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    const call = agentRunner.run.mock.calls[0][0]
    expect(call.messages).toEqual([{ role: 'user', content: 'Summarise yesterday’s tickets' }])
    expect(call.metadata).toMatchObject({ conversationId: out.conversationId, agentId: 'reporter', autonomous: true })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ turnText: 'Summarise yesterday’s tickets' }))
  })

  it('(+) a job an agent created runs as the owner, with the job title', async () => {
    const out = await handler()({ agentId: 'reporter', prompt: 'Morning brief', title: 'Morning brief job' }, { jobId: 'job-2', createdBy: 'agent' }) as any
    const conv = conversations.get(out.conversationId)!
    expect(conv.userId).toBe(OWNER)
    expect(conv.title).toBe('Morning brief job')
  })

  it('(+) reuse re-arms the same conversation with the new goal and runs it again', async () => {
    const first = await handler()({ agentId: 'reporter', prompt: 'Week 1 digest' }, { jobId: 'job-3', createdBy: MEMBER }) as any
    const second = await handler()({
      agentId: 'reporter', prompt: 'Week 2 digest', conversationPolicy: 'reuse', conversationId: first.conversationId,
    }, { jobId: 'job-3', createdBy: MEMBER }) as any

    expect(second.conversationId).toBe(first.conversationId)
    expect(conversations.get(first.conversationId)!.goalDescription).toBe('Week 2 digest')
    expect(agentRunner.run).toHaveBeenCalledTimes(2)
    expect(agentRunner.run.mock.calls[1][0].messages).toEqual([{ role: 'user', content: 'Week 2 digest' }])
    expect(conversationCount()).toBe(1)
  })

  it('(−) reuse of a conversation with a run in progress fails the job without a second run', async () => {
    const conv = conversations.create({ userId: MEMBER })
    conversations.update(conv.id, { status: 'working' })

    const run = handler()({ agentId: 'reporter', prompt: 'Again', conversationPolicy: 'reuse', conversationId: conv.id }, { jobId: 'j', createdBy: MEMBER })
    await expect(run).rejects.toThrow(/conversation_busy/)
    expect(runEntry).not.toHaveBeenCalled()
  })

  it("(−) reuse of another user's conversation is refused", async () => {
    const conv = conversations.create({ userId: OWNER })
    const run = handler()({ agentId: 'reporter', prompt: 'Peek', conversationPolicy: 'reuse', conversationId: conv.id }, { jobId: 'j', createdBy: MEMBER })
    await expect(run).rejects.toThrow(/conversation_forbidden/)
    expect(runEntry).not.toHaveBeenCalled()
  })

  it('(−) an unknown agent throws agent_unavailable and creates nothing', async () => {
    await expect(handler()({ agentId: 'ghost', prompt: 'Hello' }, { jobId: 'j', createdBy: MEMBER })).rejects.toThrow(/^agent_unavailable/)
    expect(conversationCount()).toBe(0)
    expect(runEntry).not.toHaveBeenCalled()
  })

  it('(−) a disabled agent throws agent_unavailable', async () => {
    agents.update('reporter', { enabled: false } as any)
    await expect(handler()({ agentId: 'reporter', prompt: 'Hello' }, { jobId: 'j', createdBy: MEMBER })).rejects.toThrow(/^agent_unavailable/)
    expect(conversationCount()).toBe(0)
  })

  it('(−) a missing prompt throws before anything is created', async () => {
    await expect(handler()({ agentId: 'reporter' }, { jobId: 'j', createdBy: MEMBER })).rejects.toThrow(/^invalid_config: prompt/)
    await expect(handler()({ agentId: 'reporter', prompt: '   ' }, { jobId: 'j', createdBy: MEMBER })).rejects.toThrow(/^invalid_config/)
    expect(conversationCount()).toBe(0)
  })

  it('(−) without the agent module the job fails with runner_unavailable', async () => {
    await expect(handler({ agents: undefined })({ agentId: 'reporter', prompt: 'Hi' }, { jobId: 'j' })).rejects.toThrow(/^runner_unavailable/)
  })

  it('(−) a run that does not start fails the job with its reason and keeps the conversation id', async () => {
    agents.update('reporter', { monthlyTokenBudget: 1 } as any)
    agents.addTokenUsage('reporter', 5)

    const err: any = await handler()({ agentId: 'reporter', prompt: 'Over budget' }, { jobId: 'j', createdBy: MEMBER }).catch((e) => e)
    expect(err).toBeInstanceOf(JobFailure)
    expect(err.message).toMatch(/^over_budget/)
    expect(err.result).toMatchObject({ agentId: 'reporter', ran: false, reason: 'over_budget' })
    expect(conversations.get(err.result.conversationId)).not.toBeNull()
    expect(agentRunner.run).not.toHaveBeenCalled()
  })
})

describe('scheduler agent_run effort (E6)', () => {
  function storedEffort(conversationId: string): unknown {
    return (db.all(sql`SELECT effort FROM conversations WHERE id = ${conversationId}`) as any[])[0].effort
  }

  it('(+) a job effort is stored on the run conversation and reaches the runner as the conversation\'s own', async () => {
    agents.update('reporter', { effort: 'low' } as any)
    const out = await handler()({ agentId: 'reporter', prompt: 'Deep dive', effort: 'high' }, { jobId: 'j', createdBy: MEMBER }) as any

    expect(storedEffort(out.conversationId)).toBe('high')
    expect(conversations.get(out.conversationId)!.effort).toBe('high')
    expect(agentRunner.run.mock.calls[0][0].effort).toEqual({ level: 'high', source: 'conversation' })
  })

  it('(+) no job effort → the run takes the agent\'s effort', async () => {
    agents.update('reporter', { effort: 'low' } as any)
    const out = await handler()({ agentId: 'reporter', prompt: 'Brief' }, { jobId: 'j', createdBy: MEMBER }) as any

    expect(storedEffort(out.conversationId)).toBeNull()
    expect(agentRunner.run.mock.calls[0][0].effort).toEqual({ level: 'low', source: 'agent' })
  })

  it("(+) 'auto' stores NULL (never the string 'auto'); with no agent effort the runner sends no intent", async () => {
    const out = await handler()({ agentId: 'reporter', prompt: 'Brief', effort: 'auto' }, { jobId: 'j', createdBy: MEMBER }) as any

    expect(storedEffort(out.conversationId)).toBeNull()
    expect(agentRunner.run.mock.calls[0][0].effort).toBeUndefined()
  })

  it('(+) reuse: the job decides the effort on every run — Auto clears a level a previous run left', async () => {
    agents.update('reporter', { effort: 'medium' } as any)
    const first = await handler()({ agentId: 'reporter', prompt: 'Week 1', effort: 'max' }, { jobId: 'j', createdBy: MEMBER }) as any
    expect(storedEffort(first.conversationId)).toBe('max')

    await handler()({
      agentId: 'reporter', prompt: 'Week 2', conversationPolicy: 'reuse', conversationId: first.conversationId,
    }, { jobId: 'j', createdBy: MEMBER })

    expect(storedEffort(first.conversationId)).toBeNull()
    expect(agentRunner.run.mock.calls[1][0].effort).toEqual({ level: 'medium', source: 'agent' })
  })

  it("(−) an effort that is not a ladder rung fails the job before anything is created or run", async () => {
    await expect(handler()({ agentId: 'reporter', prompt: 'Brief', effort: 'bogus' }, { jobId: 'j', createdBy: MEMBER }))
      .rejects.toThrow(/^invalid_config: effort/)
    await expect(handler()({ agentId: 'reporter', prompt: 'Brief', effort: 'HIGH' }, { jobId: 'j', createdBy: MEMBER }))
      .rejects.toThrow(/^invalid_config: effort/)
    expect(conversationCount()).toBe(0)
    expect(runEntry).not.toHaveBeenCalled()
  })
})

describe('AgentRunConfigSchema', () => {
  it('(+) accepts the stored shape and drops unknown legacy keys', () => {
    const parsed = parseAgentRunConfig(JSON.stringify({ agentId: 'a', prompt: 'p', channelNotify: 'x' }))
    expect(parsed).toEqual({ ok: true, config: { agentId: 'a', prompt: 'p' } })
  })

  it("(+) effort: a rung passes through; 'auto' and null become null; absent stays absent", () => {
    expect(parseAgentRunConfig({ agentId: 'a', prompt: 'p', effort: 'xhigh' })).toEqual({ ok: true, config: { agentId: 'a', prompt: 'p', effort: 'xhigh' } })
    expect(parseAgentRunConfig(JSON.stringify({ agentId: 'a', prompt: 'p', effort: 'auto' }))).toEqual({ ok: true, config: { agentId: 'a', prompt: 'p', effort: null } })
    expect(parseAgentRunConfig({ agentId: 'a', prompt: 'p', effort: null })).toEqual({ ok: true, config: { agentId: 'a', prompt: 'p', effort: null } })
    const absent = parseAgentRunConfig({ agentId: 'a', prompt: 'p' })
    expect(absent.ok && 'effort' in absent.config).toBe(false)
  })

  it('(−) effort: anything but a rung, auto or null is refused', () => {
    for (const effort of ['bogus', 'MAX', ' high', 3, true, {}]) {
      const parsed = parseAgentRunConfig({ agentId: 'a', prompt: 'p', effort })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(/^effort:/)
    }
  })

  it('(−) rejects invalid JSON, a missing agent and an unknown policy', () => {
    expect(parseAgentRunConfig('{not json').ok).toBe(false)
    expect(parseAgentRunConfig({ prompt: 'p' }).ok).toBe(false)
    expect(AgentRunConfigSchema.safeParse({ agentId: 'a', prompt: 'p', conversationPolicy: 'sometimes' }).success).toBe(false)
  })
})

describe('agent_run through the scheduler (Recent executions)', () => {
  const quietLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as unknown as Logger

  function executions(jobId: string): any[] {
    return db.all(sql`SELECT status, error, result FROM job_executions WHERE job_id = ${jobId} ORDER BY id`) as any[]
  }

  it('(+) a completed run records its conversation on the execution row; the job creator owns it', async () => {
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, quietLogger)
    scheduler.registerHandler('scheduler.agent_run', handler())
    const job = scheduler.create({
      name: 'Digest', triggerType: 'manual', triggerConfig: '{}', handler: 'scheduler.agent_run', kind: 'agent_run',
      handlerConfig: JSON.stringify({ agentId: 'reporter', prompt: 'Daily digest' }), createdBy: MEMBER,
    })

    await scheduler.run(job.id)

    const [row] = executions(job.id)
    expect(row.status).toBe('completed')
    const result = JSON.parse(row.result)
    expect(result).toMatchObject({ agentId: 'reporter', ran: true })
    expect(conversations.get(result.conversationId)!.userId).toBe(MEMBER)
  })

  it('(−) a failed run is a failed execution with its reason and the conversation id', async () => {
    ensureSchedulerTables(db)
    agents.update('reporter', { monthlyTokenBudget: 1 } as any)
    agents.addTokenUsage('reporter', 5)
    const scheduler = createSchedulerService(db, quietLogger)
    scheduler.registerHandler('scheduler.agent_run', handler())
    const job = scheduler.create({
      name: 'Digest', triggerType: 'manual', triggerConfig: '{}', handler: 'scheduler.agent_run', kind: 'agent_run',
      handlerConfig: JSON.stringify({ agentId: 'reporter', prompt: 'Daily digest' }), createdBy: MEMBER,
    })

    await scheduler.run(job.id)

    const [row] = executions(job.id)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/^over_budget/)
    expect(JSON.parse(row.result)).toMatchObject({ ran: false, reason: 'over_budget' })
    expect(scheduler.get(job.id)!.consecutiveFails).toBe(1)
  })

  it('(−) a plain handler error leaves the failed row without a result', async () => {
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, quietLogger)
    scheduler.registerHandler('scheduler.agent_run', handler())
    const job = scheduler.create({
      name: 'Ghost', triggerType: 'manual', triggerConfig: '{}', handler: 'scheduler.agent_run', kind: 'agent_run',
      handlerConfig: JSON.stringify({ agentId: 'ghost', prompt: 'Hello' }), createdBy: MEMBER,
    })

    await scheduler.run(job.id)

    const [row] = executions(job.id)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/^agent_unavailable/)
    expect(row.result).toBeNull()
  })
})
