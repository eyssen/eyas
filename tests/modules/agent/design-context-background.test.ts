// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A design attached to a conversation reaches the model on the BACKGROUND path
// too, not only in interactive chat. Without this a scheduled run works blind
// on the very design its output is then judged against by the brand critic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService, type DesignService } from '@modules/design/design-service'
import { createMemoryDb } from '../../helpers/test-db'

let db: any
let root: string
let designs: DesignService
let deps: any
let runCalls: any[]

const board = (body: string) => `<x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>`

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT, project_id TEXT,
    goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER,
    effort TEXT, orchestration TEXT, working_directories TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT)`)
  ensureRunSupervisionSchema(database)
  ensureAgentPlansSchema(database)
  createDesignTables(database)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-designbg-'))
  db = createMemoryDb()
  createTables(db)
  designs = createDesignService(db, createDesignStore(join(root, 'designs')))

  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, project_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'proj-1', 'refresh the landing page', ${now}, ${now})`)

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
    getDesigns: () => designs,
  }
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('design context on a background run', () => {
  it('reaches the model when the design is attached to the conversation', async () => {
    const d = designs.create({ title: 'Landing v3', files: { 'Main.dc.html': board('<h1>Landing</h1>') } })
    designs.link(d.id, 'conversations', 'conv-1')

    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toContain('Landing v3')
    expect(runCalls[0].system).toContain('base prompt')
  })

  it('does NOT resolve the project at run time — inheritance happened by copy', async () => {
    // A project's designs are copied onto a conversation when it is created in
    // the project (board/routes.ts, conversations/routes.ts), exactly as
    // indexedSources and workingDirectories are. Reading the project again here
    // would be a second source of truth that the conversation cannot detach.
    const d = designs.create({ title: 'House style', files: { 'Main.dc.html': board('<h1>House</h1>') } })
    designs.link(d.id, 'projects', 'proj-1')

    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toBe('base prompt')
  })

  it('sees a project design once it has been copied across', async () => {
    const d = designs.create({ title: 'House style', files: { 'Main.dc.html': board('<h1>House</h1>') } })
    designs.link(d.id, 'projects', 'proj-1')
    designs.adoptProjectDesigns('conv-1', 'proj-1')

    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toContain('House style')
  })

  it('leaves the prompt untouched when nothing is attached', async () => {
    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toBe('base prompt')
  })

  it('does not cost the run its answer when the design service throws', async () => {
    deps.getDesigns = () => { throw new Error('design store on fire') }
    const result = await runConversation('conv-1', deps)
    expect(result.ran).toBe(true)
    expect(runCalls[0].system).toBe('base prompt')
  })

  it('is a no-op when no design service is wired at all', async () => {
    delete deps.getDesigns
    await runConversation('conv-1', deps)
    expect(runCalls[0].system).toBe('base prompt')
  })
})

describe('workspace outputs on a background run', () => {
  it('registers what the run wrote as a document on the conversation', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const workspace = mkdtempSync(join(tmpdir(), 'eyas-bgws-'))
    try {
      db.run(sql`UPDATE conversations SET working_directories = ${JSON.stringify([workspace])} WHERE id = 'conv-1'`)

      const uploaded: string[] = []
      const linked: Array<[string, string]> = []
      deps.getDocuments = () => ({
        upload: async ({ filename }: any) => { uploaded.push(filename); return { id: `doc-${uploaded.length}` } },
        link: (docId: string, mod: string, owner: string) => { linked.push([mod, owner]) },
      })
      // The runner writes nothing itself, so stand in for the CLI's own file tool.
      deps.agentRunner = {
        run: vi.fn((opts: any) => {
          runCalls.push(opts)
          writeFileSync(join(workspace, 'report.html'), '<p>done</p>')
          return { async *[Symbol.asyncIterator]() { yield { type: 'turn_complete', tokensUsed: 1 } } }
        }),
      }

      await runConversation('conv-1', deps)
      expect(uploaded).toEqual(['report.html'])
      expect(linked).toEqual([['conversations', 'conv-1']])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('is a no-op when the conversation has no working directory', async () => {
    const upload = vi.fn()
    deps.getDocuments = () => ({ upload, link: vi.fn() })
    await runConversation('conv-1', deps)
    expect(upload).not.toHaveBeenCalled()
  })

  it('does not cost the run its result when the documents service throws', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const workspace = mkdtempSync(join(tmpdir(), 'eyas-bgws2-'))
    try {
      db.run(sql`UPDATE conversations SET working_directories = ${JSON.stringify([workspace])} WHERE id = 'conv-1'`)
      writeFileSync(join(workspace, 'x.html'), 'x')
      deps.getDocuments = () => { throw new Error('documents on fire') }
      const result = await runConversation('conv-1', deps)
      expect(result.ran).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
