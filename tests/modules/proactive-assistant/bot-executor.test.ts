import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createBotExecutor } from '@modules/proactive-assistant/bot-executor'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let mockAgentRunner: any
let mockAgentRegistry: any
let mockToolRegistry: any
let mockLogger: any
let executor: ReturnType<typeof createBotExecutor>

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    bot_listen INTEGER NOT NULL DEFAULT 0,
    auto_assignee_id TEXT,
    created_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT,
    project_id TEXT,
    goal_description TEXT,
    provider_id TEXT,
    model_id TEXT,
    stage_id TEXT,
    team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off',
    thinking_budget INTEGER,
    effort TEXT,
    orchestration TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)

  mockAgentRunner = {
    run: vi.fn(),
  }

  mockAgentRegistry = {
    get: vi.fn().mockReturnValue({
      id: 'test-agent',
      enabled: true,
      systemPrompt: 'You are a test agent',
      tools: ['tool1'],
      maxTurns: 10,
      model: 'test-model',
    }),
    isWithinBudget: vi.fn().mockReturnValue(true),
    addTokenUsage: vi.fn(),
  }

  mockToolRegistry = {
    toToolDefinitions: vi.fn().mockReturnValue([{ name: 'tool1' }]),
  }

  mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  executor = createBotExecutor({
    db,
    agentRunner: mockAgentRunner,
    agentRegistry: mockAgentRegistry,
    toolRegistry: mockToolRegistry,
    logger: mockLogger,
  })
})

// Helper to create an async iterable from events
function createAsyncIterable(events: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
  }
}

describe('BotExecutor', () => {
  it('returns 0 when no bot-listening stages exist', async () => {
    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  it('processes waiting conversations in bot-listening stages', async () => {
    const now = new Date().toISOString()

    // Create a bot-listening stage
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)

    // Create a waiting conversation
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Test Conv', 'waiting', 'managed', 'test-agent', 'Complete the task', 'stage-1', ${now}, ${now})`)

    mockAgentRunner.run.mockReturnValue(createAsyncIterable([
      { type: 'turn_complete', tokensUsed: 500 },
      { type: 'turn_complete', tokensUsed: 300 },
    ]))

    const processed = await executor.processWaiting()
    expect(processed).toBe(1)

    // Verify agent runner was called
    expect(mockAgentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'Complete the task' }],
      maxTurns: 10,
    }))

    // Verify token usage was recorded
    expect(mockAgentRegistry.addTokenUsage).toHaveBeenCalledWith('test-agent', 800)

    // Verify conversation status was set to idle
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('idle')
  })

  it('skips conversations without agent_id', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'No Agent', 'waiting', 'managed', ${null}, 'Some goal', 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
    expect(mockAgentRunner.run).not.toHaveBeenCalled()
  })

  it('skips conversations without goal_description', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'No Goal', 'waiting', 'managed', 'test-agent', ${null}, 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  it('skips disabled agents', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Disabled Agent', 'waiting', 'managed', 'disabled-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    mockAgentRegistry.get.mockReturnValue({ id: 'disabled-agent', enabled: false })

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  it('skips agents over budget', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Over Budget', 'waiting', 'managed', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    mockAgentRegistry.isWithinBudget.mockReturnValue(false)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('skips simple mode conversations', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Simple', 'waiting', 'simple', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  it('handles agent runner errors gracefully', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Error Conv', 'waiting', 'autonomous', 'test-agent', 'Fail task', 'stage-1', ${now}, ${now})`)

    mockAgentRunner.run.mockImplementation(() => {
      throw new Error('Agent crashed')
    })

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
    expect(mockLogger.error).toHaveBeenCalled()

    // Conversation should be reset to idle even after error
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('idle')
  })

  // D6 (F2 T2) regression: 'waiting_approval' (a run parked pending an
  // operator decision) must NOT be claimed by the bot-executor — only the
  // exact literal 'waiting' status is a pickup signal. Task 5/6 own resuming
  // a parked run via supervisor.unpark(), not this scan.
  it("does not claim a card parked in 'waiting_approval' (only 'waiting' is claimed)", async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Parked', 'waiting_approval', 'managed', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
    expect(mockAgentRunner.run).not.toHaveBeenCalled()
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('waiting_approval')
  })

  it('ignores non-bot-listening stages', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Normal Stage', 0, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Normal Conv', 'waiting', 'managed', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  it('processes multiple conversations across multiple stages', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage 1', 1, ${now})`)
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-2', 'Bot Stage 2', 1, ${now})`)

    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Conv 1', 'waiting', 'managed', 'test-agent', 'Task 1', 'stage-1', ${now}, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-2', 'Conv 2', 'waiting', 'autonomous', 'test-agent', 'Task 2', 'stage-2', ${now}, ${now})`)

    mockAgentRunner.run.mockReturnValue(createAsyncIterable([
      { type: 'turn_complete', tokensUsed: 100 },
    ]))

    const processed = await executor.processWaiting()
    expect(processed).toBe(2)
  })

  it('passes the supervisor sessionId into the runner for event capture', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Capture', 'waiting', 'managed', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    mockAgentRunner.run.mockReturnValue(createAsyncIterable([{ type: 'turn_complete', tokensUsed: 10 }]))
    const handle = { sessionId: 'sess-abc', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const supervisor = { beginRun: vi.fn().mockReturnValue(handle) }
    const exec2 = createBotExecutor({
      db,
      agentRunner: mockAgentRunner,
      agentRegistry: mockAgentRegistry,
      toolRegistry: mockToolRegistry,
      logger: mockLogger,
      supervisor,
    })

    await exec2.processWaiting()

    expect(mockAgentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-abc' }))
  })

  it('skips conversations with unregistered agents', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Unknown Agent', 'waiting', 'managed', 'unknown-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    mockAgentRegistry.get.mockReturnValue(null)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
  })

  // A stage that names an auto-assignee is bot-capable even with bot_listen=0 —
  // the scan used to look at bot_listen alone, so those stages never ran.
  it('picks up cards in an auto-assignee-only stage (bot_listen = 0)', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, auto_assignee_id, created_at) VALUES ('stage-1', 'Auto Stage', 0, 'test-agent', ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Auto Conv', 'waiting', 'managed', 'test-agent', 'Do the auto thing', 'stage-1', ${now}, ${now})`)

    mockAgentRunner.run.mockReturnValue(createAsyncIterable([{ type: 'turn_complete', tokensUsed: 42 }]))

    const processed = await executor.processWaiting()
    expect(processed).toBe(1)
  })

  it('still ignores a plain stage with neither bot_listen nor an auto-assignee', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, auto_assignee_id, created_at) VALUES ('stage-1', 'Plain', 0, ${null}, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Plain Conv', 'waiting', 'managed', 'test-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    const processed = await executor.processWaiting()
    expect(processed).toBe(0)
    expect(mockAgentRunner.run).not.toHaveBeenCalled()
  })

  it('re-checks the waiting claim immediately before running (no double-run on a stale scan)', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Claimed', 'waiting', 'managed', 'test-agent', 'Task 1', 'stage-1', ${now}, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-2', 'Runnable', 'waiting', 'managed', 'test-agent', 'Task 2', 'stage-1', ${now}, ${now})`)

    // Both cards are in the scan snapshot. While the first one runs, "someone
    // else" claims the second — the pre-run re-SELECT must notice and skip it
    // instead of starting a second run on an already-claimed card.
    mockAgentRunner.run.mockImplementation(() => {
      db.run(sql`UPDATE conversations SET status = 'working' WHERE id = 'conv-2'`)
      return createAsyncIterable([{ type: 'turn_complete', tokensUsed: 10 }])
    })

    const processed = await executor.processWaiting()

    expect(mockAgentRunner.run).toHaveBeenCalledTimes(1)
    expect(processed).toBe(1)
    // The stolen card is left exactly as the other claimant set it.
    const conv2 = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-2'`) as any[])[0]
    expect(conv2.status).toBe('working')
  })

  it('warns ONCE about a parked card whose agent cannot run it', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Orphaned', 'waiting', 'managed', 'deleted-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)

    // Agent was deleted/disabled after the card was armed.
    mockAgentRegistry.get.mockReturnValue(null)

    await executor.processWaiting()
    await executor.processWaiting()

    const warns = mockLogger.warn.mock.calls.filter((c: any[]) =>
      JSON.stringify(c).includes('needs operator attention'))
    expect(warns).toHaveLength(1)

    // The card is NOT failed — an agent enabled later must still pick it up.
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('waiting')
  })

  it('warns again after an unrunnable card leaves and re-enters the waiting set', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Orphaned', 'waiting', 'managed', 'deleted-agent', 'Do stuff', 'stage-1', ${now}, ${now})`)
    mockAgentRegistry.get.mockReturnValue(null)

    await executor.processWaiting()
    db.run(sql`UPDATE conversations SET status = 'idle' WHERE id = 'conv-1'`)
    await executor.processWaiting()
    db.run(sql`UPDATE conversations SET status = 'waiting' WHERE id = 'conv-1'`)
    await executor.processWaiting()

    const warns = mockLogger.warn.mock.calls.filter((c: any[]) =>
      JSON.stringify(c).includes('needs operator attention'))
    expect(warns).toHaveLength(2)
  })

  it('coalesces concurrent processWaiting() calls into a single in-flight pass', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, name, bot_listen, created_at) VALUES ('stage-1', 'Bot Stage', 1, ${now})`)
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, stage_id, created_at, updated_at)
      VALUES ('conv-1', 'Single Flight', 'waiting', 'managed', 'test-agent', 'Task', 'stage-1', ${now}, ${now})`)

    let inFlight = 0
    let maxConcurrent = 0
    mockAgentRunner.run.mockImplementation(() => {
      inFlight++
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise(r => setTimeout(r, 10))
          yield { type: 'turn_complete', tokensUsed: 1 }
          inFlight--
        },
      }
    })

    const [a, b, c] = await Promise.all([
      executor.processWaiting(),
      executor.processWaiting(),
      executor.processWaiting(),
    ])

    expect(mockAgentRunner.run).toHaveBeenCalledTimes(1)
    expect(maxConcurrent).toBe(1)
    // All three callers piggyback on the SAME in-flight pass, so they resolve
    // with the same count. Without the guard the later two would start their
    // own scan, find the card already claimed, and report 0 — that difference
    // is what pins the coalescing rather than the incidental serialization the
    // runner's own status write provides.
    expect([a, b, c]).toEqual([1, 1, 1])
  })
})
