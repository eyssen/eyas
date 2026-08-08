// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 3 (+ post-review hardening). resumeRun assembles a
// warm-resume from a terminal run: lossless checkpoint seed (or goal reseed),
// a do-not-repeat recap, and a destructive idempotency ledger built from the
// run's SUCCESSFUL ToolResult events (so a failed destructive op can be retried
// and a ToolCall-append failure does not silently drop protection). Both retry
// (seedFromCheckpoint:false) and refresh (default) arm the ledger.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { resumeRun } from '@modules/agent/conversation-runner'
import { argHash } from '@modules/agent/arg-hash'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { createCheckpointTables, createCheckpointServices } from '@modules/agent/checkpoint'

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

// Simulate what the runner records: a ToolResult event carrying toolName + argHash.
async function recordToolResult(events: any, sessionId: string, toolName: string, input: any, success: boolean) {
  await events.append({
    sessionId, type: 'ToolResult',
    payload: { toolUseId: `${toolName}-${success}`, toolName, argHash: argHash(input), argPreview: JSON.stringify(input), output: {}, durationMs: 1, success },
  })
}

let db: ReturnType<typeof createMemoryDb>
let events: ReturnType<typeof createEventStore>
let checkpoints: ReturnType<typeof createCheckpointServices>
let deps: any
let handle: any

beforeEach(() => {
  db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  createEventStoreTables(db)
  createCheckpointTables(db)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, status TEXT, mode TEXT, agent_id TEXT, project_id TEXT, goal_description TEXT,
    provider_id TEXT, model_id TEXT, team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT, orchestration TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT, updated_at TEXT
  )`)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, status, mode, agent_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'idle', 'autonomous', 'agent-1', 'Finish the report', ${now}, ${now})`)
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
    VALUES ('old-run', 'conv-1', 'agent-1', 'failed', ${now})`)

  events = createEventStore(db)
  checkpoints = createCheckpointServices(db, { eventStore: events })

  handle = { sessionId: 'new-run', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
  deps = {
    db,
    agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 1 }])) },
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 5, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
    supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventStore: events,
    getCheckpoint: () => checkpoints,
  }
})

describe('resumeRun (Cap 3 Step 3 + hardening)', () => {
  it('resumes from the latest checkpoint with a do-not-repeat recap and a destructive idempotency ledger', async () => {
    await recordToolResult(events, 'old-run', 'write_file', { path: '/x' }, true)
    await recordToolResult(events, 'old-run', 'search_memory', { q: 1 }, true)

    const modelMessages = [
      { role: 'user', content: 'Finish the report' },
      { role: 'assistant', content: [{ type: 'text', text: 'working on it' }] },
    ]
    await checkpoints.api.createCheckpoint({
      sessionId: 'old-run', eventSeq: 1, label: 'turn 1', kind: 'auto', actor: 'agent-1',
      state: {
        sessionId: 'old-run', lastSeq: 1, eventCount: 2, currentState: 'working',
        messages: [], toolCalls: [], pendingApprovals: [], grantedApprovals: [],
        tokensUsed: { input: 0, output: 0 }, lastCheckpointSeq: null, lastCheckpointRef: null,
        turn: 1, meta: { modelMessages },
      },
    })

    const result = await resumeRun('old-run', deps)

    expect(result.ran).toBe(true)
    expect(result.sessionId).toBe('new-run')
    const opts = deps.agentRunner.run.mock.calls[0][0]
    expect(opts.messages).toEqual(modelMessages)
    expect(opts.reinjection).toContain('Finish the report')
    expect(opts.reinjection).toContain('write_file')
    expect(opts.idempotencyLedger.has(`write_file:${argHash({ path: '/x' })}`)).toBe(true)
    // non-destructive call is advisory only — NOT hard-blocked
    expect(opts.idempotencyLedger.has(`search_memory:${argHash({ q: 1 })}`)).toBe(false)
  })

  it('treats ACTUALLY-REGISTERED destructive tools (run_command, send_agent_message) as ledgered', async () => {
    await recordToolResult(events, 'old-run', 'run_command', { cmd: 'rm -rf /tmp/x' }, true)
    await recordToolResult(events, 'old-run', 'send_agent_message', { to: 'b', text: 'hi' }, true)
    await recordToolResult(events, 'old-run', 'search_memory', { q: 'safe' }, true)

    await resumeRun('old-run', deps)
    const opts = deps.agentRunner.run.mock.calls[0][0]
    expect(opts.idempotencyLedger.has(`run_command:${argHash({ cmd: 'rm -rf /tmp/x' })}`)).toBe(true)
    expect(opts.idempotencyLedger.has(`send_agent_message:${argHash({ to: 'b', text: 'hi' })}`)).toBe(true)
    expect(opts.idempotencyLedger.has(`search_memory:${argHash({ q: 'safe' })}`)).toBe(false) // read-only
  })

  it('ledgers the newly-covered destructive tools and EXCLUDES idempotent reads', async () => {
    await recordToolResult(events, 'old-run', 'workspace_append', { file: 'AGENTS.md', text: 'x' }, true)
    await recordToolResult(events, 'old-run', 'add_internal_contact', { id: 'a' }, true)
    await recordToolResult(events, 'old-run', 'forge_propose_soul_change', { p: 1 }, true)
    await recordToolResult(events, 'old-run', 'save_memory', { content: 'note' }, true)
    await recordToolResult(events, 'old-run', 'research', { query: 'q' }, true)
    await recordToolResult(events, 'old-run', 'browser_navigate', { url: 'u' }, true)

    await resumeRun('old-run', deps)
    const led = deps.agentRunner.run.mock.calls[0][0].idempotencyLedger
    // non-idempotent writes → ledgered (save_memory INSERTs a new entry each call)
    expect(led.has(`workspace_append:${argHash({ file: 'AGENTS.md', text: 'x' })}`)).toBe(true)
    expect(led.has(`add_internal_contact:${argHash({ id: 'a' })}`)).toBe(true)
    expect(led.has(`forge_propose_soul_change:${argHash({ p: 1 })}`)).toBe(true)
    expect(led.has(`save_memory:${argHash({ content: 'note' })}`)).toBe(true)
    // data-returning reads → NOT ledgered (hard-skip returns a stub → would starve a retry)
    expect(led.has(`research:${argHash({ query: 'q' })}`)).toBe(false)
    expect(led.has(`browser_navigate:${argHash({ url: 'u' })}`)).toBe(false)
  })

  it('refuses to resume when the ledger build throws (fail safe, not a silent empty ledger)', async () => {
    const throwingStore = { getByTypes: async () => { throw new Error('SQLITE_BUSY') } }
    const result = await resumeRun('old-run', { ...deps, eventStore: throwingStore as any })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('ledger_unavailable')
  })

  it('inherits the destructive ledger across a resume chain (parent run events)', async () => {
    await recordToolResult(events, 'old-run', 'send_agent_message', { to: 'b' }, true)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, parent_run_id)
      VALUES ('run-1', 'conv-1', 'agent-1', 'failed', ${now}, 'old-run')`)

    await resumeRun('run-1', deps)
    const led = deps.agentRunner.run.mock.calls[0][0].idempotencyLedger
    // run-1 has no send of its own, but inherits it from its parent old-run
    expect(led.has(`send_agent_message:${argHash({ to: 'b' })}`)).toBe(true)
  })

  it('refuses to resume when the event-store is absent (no ledger source = no re-fire guard)', async () => {
    const result = await resumeRun('old-run', { ...deps, eventStore: undefined })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('event_store_required')
    expect(deps.agentRunner.run).not.toHaveBeenCalled()
  })

  it('builds the ledger only from SUCCESSFUL destructive results (a failed op can be retried)', async () => {
    await recordToolResult(events, 'old-run', 'send_email', { to: 'a@x' }, false) // failed → retryable, NOT ledgered
    await recordToolResult(events, 'old-run', 'write_file', { path: '/y' }, true)  // succeeded → ledgered

    const result = await resumeRun('old-run', deps)
    const opts = deps.agentRunner.run.mock.calls[0][0]
    expect(opts.idempotencyLedger.has(`write_file:${argHash({ path: '/y' })}`)).toBe(true)
    expect(opts.idempotencyLedger.has(`send_email:${argHash({ to: 'a@x' })}`)).toBe(false)
  })

  it('arms the ledger even on a goal reseed (seedFromCheckpoint:false = retry semantics)', async () => {
    await recordToolResult(events, 'old-run', 'write_file', { path: '/z' }, true)

    const result = await resumeRun('old-run', deps, { seedFromCheckpoint: false })
    expect(result.ran).toBe(true)
    const opts = deps.agentRunner.run.mock.calls[0][0]
    // goal reseed (no checkpoint messages) ...
    expect(opts.messages).toEqual([{ role: 'user', content: 'Finish the report' }])
    // ... but the destructive ledger + recap are STILL armed (the #1 fix)
    expect(opts.idempotencyLedger.has(`write_file:${argHash({ path: '/z' })}`)).toBe(true)
    expect(opts.reinjection).toContain('write_file')
  })

  it('falls back to recap-reseed (goal) when there is no checkpoint', async () => {
    const result = await resumeRun('old-run', deps)
    expect(result.ran).toBe(true)
    const opts = deps.agentRunner.run.mock.calls[0][0]
    expect(opts.messages).toEqual([{ role: 'user', content: 'Finish the report' }])
    expect(opts.reinjection).toContain('Finish the report')
  })

  it('returns {ran:false, reason:not_found} for an unknown run id', async () => {
    const result = await resumeRun('nope', deps)
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('not_found')
  })
})
