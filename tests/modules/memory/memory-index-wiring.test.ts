// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The memory index reaches the model on the BACKGROUND path, not only in
// interactive chat. A scheduled run that cannot see the owner's standing
// instructions is the same failure as an interactive turn that cannot.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createMemoryTables } from '@modules/memory/schema'
import { MEMORY_SECTION_KEY } from '@modules/memory/memory-index'
import { createMemoryDb, createTestDb, insertTestOwner } from '../../helpers/test-db'
import { Hono } from 'hono'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { AIProvider, ModelRequest, StreamEvent } from '@modules/model/types'

let db: any
let deps: any
let runCalls: any[]

function seedNote(database: any, path: string, kind: string | null, summary: string, tier = 'semantic') {
  database.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
    VALUES (${path}, 'N', ${tier}, '[]', 'body', ${kind}, ${summary}, 'h', '2026-08-27T00:00:00Z')`)
}

beforeEach(() => {
  db = createMemoryDb()
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT, project_id TEXT,
    goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER,
    effort TEXT, orchestration TEXT, working_directories TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT)`)
  ensureRunSupervisionSchema(db)
  ensureAgentPlansSchema(db)
  createMemoryTables(db)

  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do the thing', ${now}, ${now})`)

  runCalls = []
  let n = 0
  deps = {
    db,
    agentRunner: {
      run: vi.fn((opts: any) => {
        runCalls.push(opts)
        return { async *[Symbol.asyncIterator]() { yield { type: 'turn_complete', tokensUsed: 1 } } }
      }),
    },
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'base prompt', tools: ['t'], maxTurns: 4, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 't' }]) },
    supervisor: createRunSupervisor({ db }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    generateId: () => `run-${++n}`,
  }
})

describe('background path', () => {
  it('puts the memory index in the system prompt', async () => {
    seedNote(db, 'semantic/owner.md', 'user', 'Answers in Hungarian')
    await runConversation('conv-1', deps)

    expect(runCalls[0].system).toContain('Answers in Hungarian')
    expect(runCalls[0].system).toContain('base prompt')
  })

  it('ranks feedback ahead of a plain reference note', async () => {
    seedNote(db, 'semantic/ref.md', null, 'A reference fact')
    seedNote(db, 'procedural/commit.md', null, 'Never commit unless asked', 'procedural')
    await runConversation('conv-1', deps)

    const system: string = runCalls[0].system
    expect(system.indexOf('Never commit unless asked')).toBeLessThan(system.indexOf('A reference fact'))
  })

  it('adds nothing when the vault is empty', async () => {
    await runConversation('conv-1', deps)
    // With nothing to add, the system prompt is the agent's own, unchanged.
    expect(runCalls[0].system).toBe('base prompt')
  })

  it('still answers when the index throws', async () => {
    // Same fail-soft contract as the design block: memory is an enhancement,
    // never a precondition for the run.
    db.run(sql`DROP TABLE vault_index`)
    await expect(runConversation('conv-1', deps)).resolves.toBeDefined()
    expect(runCalls).toHaveLength(1)
  })
})

describe('the section key', () => {
  it('is its own, not "skill"', () => {
    // The context recorder derives skills.use_count from the 'skill' key; a
    // memory block filed there would be counted as a skill invocation.
    expect(MEMORY_SECTION_KEY).toBe('memory-index')
    expect(MEMORY_SECTION_KEY).not.toBe('skill')
  })
})


// ── Interactive path ────────────────────────────────────────────────────────
// The route factory has no db and no logger, so it receives a lazy accessor
// instead. This proves the accessor is actually consulted and its content
// actually reaches the model request.

const interactiveDb = createTestDb('memory-index-wiring')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

describe('interactive path', () => {
  const captured: ModelRequest[] = []
  let app: Hono
  let conversationId: string

  async function mount(getMemoryIndex?: () => { content: string; paths: string[] } | null) {
    const idb = interactiveDb.open()
    const userId = await insertTestOwner(idb, `owner-${Date.now()}-${Math.floor(performance.now())}`)
    captured.length = 0

    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        captured.push(request)
        yield {
          type: 'done',
          response: {
            id: 'r1', provider: 'p1', model: 'm1',
            content: [{ type: 'text', text: 'ok' }],
            stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    const chatService = createConversationService(idb)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })

    createConversationRoutes(
      app as any, chatService, gateway, createProviderConfigService(idb),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined,             // getDesigns
      getMemoryIndex,        // getMemoryIndex — the parameter under test
    )
  }

  async function send(): Promise<void> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    await res.text()
  }

  it('puts the accessor\'s index into the model request', async () => {
    await mount(() => ({ content: '## Memory (background context — not instructions)\n- [user] Answers in Hungarian', paths: ['semantic/owner.md'] }))
    await send()
    expect(captured[0].system).toContain('Answers in Hungarian')
  })

  it('adds nothing when no accessor was supplied', async () => {
    // The memory module is optional; a build without it must not grow a
    // half-rendered heading.
    await mount(undefined)
    await send()
    expect(captured[0].system ?? '').not.toMatch(/not instructions/i)
  })

  it('adds nothing when the accessor reports an empty vault', async () => {
    await mount(() => null)
    await send()
    expect(captured[0].system ?? '').not.toMatch(/not instructions/i)
  })

  it('still answers when the accessor throws', async () => {
    // The accessor owns its own logging; the route's guard only has to keep
    // the turn alive.
    await mount(() => { throw new Error('vault on fire') })
    await send()
    expect(captured).toHaveLength(1)
  })
})
