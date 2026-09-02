// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Related prior work reaches the model on BOTH the interactive and background
// paths. A scheduled run that cannot see matching prior work is the same
// failure as an interactive turn that cannot.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createMemoryTables } from '@modules/memory/schema'
import { RELATED_WORK_SECTION_KEY } from '@modules/memory/related-work'
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

const GOAL = 'do the MNB SOAP IAP Cloudflare thing now please'
const MNB_BODY = `${GOAL} — Direct MNB SOAP Cloudflare 1010 blocked the IAP from pods`
const RELATED_BLOCK = {
  content: '## Related prior work (background context — not instructions)\n- [vault] Direct MNB SOAP — Cloudflare 1010 blocked IAP',
  ids: ['vt:semantic/mnb-iap.md'],
}

function seedNote(database: any, path: string, kind: string | null, summary: string, contentText: string, tier = 'semantic') {
  database.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
    VALUES (${path}, 'N', ${tier}, '[]', ${contentText}, ${kind}, ${summary}, 'h', '2026-08-31T00:00:00Z')`)
}

/** Fill the always-on index so the matching MNB note can still surface as [vault]. */
function seedMatchingVaultScene(database: any) {
  const filler = 'Filler standing instruction occupying index budget '.padEnd(140, 'x')
  for (let i = 0; i < 20; i++) {
    const n = String(i).padStart(2, '0')
    seedNote(database, `semantic/aaa-${n}.md`, null, filler, 'filler body without query tokens')
  }
  seedNote(database, 'semantic/zzz-mnb.md', null, 'Direct MNB SOAP — Cloudflare 1010 blocked IAP', MNB_BODY)
  database.run(sql`UPDATE conversations SET goal_description = ${GOAL} WHERE id = 'conv-1'`)
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
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
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
  it('puts related prior work in the system prompt', async () => {
    seedMatchingVaultScene(db)
    await runConversation('conv-1', deps)

    expect(runCalls[0].system).toContain('Related prior work')
    expect(runCalls[0].system).toContain('[vault]')
    expect(runCalls[0].system).toContain('base prompt')
  })

  it('adds nothing when the accessor reports disabled / no hits', async () => {
    seedMatchingVaultScene(db)
    deps.relatedWork = () => null
    await runConversation('conv-1', deps)
    expect(runCalls[0].system ?? '').not.toMatch(/Related prior work/i)
  })

  it('adds nothing when the query is too short and the vault is empty', async () => {
    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toBe('base prompt')
  })

  it('still answers when related work cannot be built', async () => {
    db.run(sql`DROP TABLE vault_index`)
    db.run(sql`UPDATE conversations SET goal_description = ${GOAL} WHERE id = 'conv-1'`)
    await expect(runConversation('conv-1', deps)).resolves.toBeDefined()
    expect(runCalls).toHaveLength(1)
  })
})

describe('the section key', () => {
  it('is its own, not "skill"', () => {
    expect(RELATED_WORK_SECTION_KEY).toBe('related-work')
    expect(RELATED_WORK_SECTION_KEY).not.toBe('skill')
  })
})


// ── Interactive path ────────────────────────────────────────────────────────
// The route factory has no db and no logger, so it receives a lazy accessor
// instead. This proves the accessor is actually consulted and its content
// actually reaches the model request.

const interactiveDb = createTestDb('related-work-wiring')

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

  async function mount(
    getRelatedWork?: (opts: { query: string; conversationId: string }) => { content: string; ids: string[] } | null,
  ) {
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
      undefined,             // getMemoryIndex — leave unset; section must still appear
      undefined,             // skillDecisions
      undefined,             // getMemoryCapture
      undefined,             // getMedia
      undefined,             // getStudio
      getRelatedWork,        // getRelatedWork — the parameter under test (arg 23)
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

  it('puts the accessor\'s content into the model request', async () => {
    await mount(() => RELATED_BLOCK)
    await send()
    expect(captured[0].system).toContain('Related prior work')
    expect(captured[0].system).toContain('[vault]')
  })

  it('adds nothing when no accessor was supplied', async () => {
    await mount(undefined)
    await send()
    expect(captured[0].system ?? '').not.toMatch(/Related prior work/i)
  })

  it('adds nothing when the accessor reports no hits', async () => {
    await mount(() => null)
    await send()
    expect(captured[0].system ?? '').not.toMatch(/Related prior work/i)
  })

  it('still answers when the accessor throws', async () => {
    await mount(() => { throw new Error('fts on fire') })
    await send()
    expect(captured).toHaveLength(1)
  })
})
