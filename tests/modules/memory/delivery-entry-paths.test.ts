// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I5 — every entry path carries the turn block. One fixture (one project,
// prior work in it, prior work in another project, one standing note), the
// real prompt assembler and the real recall service (ctx.memoryRecall), and
// each way EYAS runs a model: interactive chat, a background run, a God Mode
// worker, the board bot, executeAgent (specialist and pipeline), a team
// member and an owner-voice channel reply. Each records a 'memory-recall'
// turn section with the same ids for the same message and project, and
// hands the runner the turn block. An A2A peer task and an external-voice
// channel reply get the clock only. Fictive projects, agents and notes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

const mocked = vi.hoisted(() => ({ runs: [] as Array<{ label: string; opts: any }> }))

// executeAgent builds its runner inside the agent module; capture what it is handed.
vi.mock('@modules/agent/agent-runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('@modules/agent/agent-runner')>()
  return {
    ...original,
    createAgentRunner: () => ({
      run: (opts: any) => {
        mocked.runs.push({ label: 'executeAgent', opts })
        return (async function* () {
          yield { type: 'text', text: 'ok' }
          yield {
            type: 'done',
            response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
            outcome: 'completed',
            stopReason: 'end',
          }
        })()
      },
    }),
  }
})

import { createTestDb, createMemoryDb, getRawFromDrizzle, insertTestOwner } from '../../helpers/test-db'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryRecall } from '@modules/memory/v2/assemble'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'
import type { DeliveryProfile } from '@modules/prompt-wizard/delivery-profile'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { runConversation } from '@modules/agent/conversation-runner'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { agentModule } from '@modules/agent/index'
import { createBotExecutor } from '@modules/proactive-assistant/bot-executor'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { wrapUntrusted } from '@shared/untrusted'
import { gistRow } from './v2/d1-fixtures'
import { seedRawRow } from './v2/extract-helpers'
import { silentLogger } from './v2/helpers'

const testDb = createTestDb('delivery-entry-paths')

/** The message every path answers. */
const TEXT = 'Reconcile the harbor invoices against the quarterly ledger again'
const PROJECT = 'proj-harbor'
const OTHER_PROJECT = 'proj-elsewhere'

const PROFILE: DeliveryProfile = {
  providerId: 'p1', modelId: 'm1', contextWindow: 100_000, supportsTools: true,
  toolAddressing: { kind: 'native' }, drillDown: true, resolved: true, windowSource: 'catalog',
}

const AGENT = {
  id: 'colleague', name: 'Colleague', role: 'assistant', enabled: true, systemPrompt: 'You help.',
  tools: [] as string[], constraints: [] as string[], maxTurns: 3, model: 'm1',
}

function file(name: string, body: string) {
  return { name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false }
}

interface Recorded { label: string; input: any }

describe('memory delivery — every entry path carries the turn block (I5)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let recorded: Recorded[]
  let assembler: ReturnType<typeof createPromptAssembler>

  function recorder(label: string) {
    return {
      record: (input: any) => { recorded.push({ label, input }); return `comp-${recorded.length}` },
      sectionsFor: () => null,
    }
  }

  function captureRunner(label: string) {
    return {
      run: (opts: any) => {
        mocked.runs.push({ label, opts })
        return (async function* () {
          yield { type: 'text', text: 'ok' }
          yield {
            type: 'done',
            response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
            outcome: 'completed',
            stopReason: 'end',
          }
        })()
      },
    }
  }

  const agentRegistry = {
    get: (id: string) => (id === AGENT.id ? AGENT : undefined),
    list: () => [AGENT],
    isWithinBudget: () => true,
    addTokenUsage: () => {},
  }
  const toolRegistry = { toToolDefinitions: () => [] }

  /** Prior work in `project`: a raw row the message matches and its task gist. */
  function priorWork(id: string, text: string, project: string): void {
    const conversationId = `prior-${id}`
    const { rid } = seedRawRow(db, { id, conversationId, content: text, projectId: project, projectTypeId: 'type-ops' })
    db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${text})`)
    gistRow(db, `g-${id}`, `${text}. ${'The reconciliation notes continue here. '.repeat(10)}`, { conv: conversationId, project, projectType: 'type-ops' })
  }

  function conversation(over: Record<string, unknown> = {}): string {
    const id = chat.create({ userId, title: 'Quarter close', providerId: 'p1', modelId: 'm1', projectId: PROJECT } as any).id
    chat.update(id, { agentId: AGENT.id, goalDescription: TEXT, ...over } as any)
    return id
  }

  beforeEach(async () => {
    mocked.runs.length = 0
    recorded = []
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    createMemoryTables(db)
    createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
    const now = new Date().toISOString()
    for (const p of [PROJECT, OTHER_PROJECT]) {
      db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES (${p}, ${p}, 'type-ops', ${now}, ${now})`)
    }
    // Standing note (global) + prior work here + prior work in another project.
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
      VALUES ('semantic/owner-ledger.md', 'N', 'semantic', '[]', 'body', 'user', 'Ledger figures are always in EUR', 'h', '2026-08-27T00:00:00Z')`)
    priorWork('here1', 'Harbor invoices reconciled against the quarterly ledger with two mismatches', PROJECT)
    priorWork('here2', 'The quarterly ledger reconciliation for harbor invoices needs the port fee export', PROJECT)
    priorWork('away1', 'Harbor invoices reconciled against the quarterly ledger for the other office', OTHER_PROJECT)

    chat = createConversationService(db)
    const recall = createMemoryRecall({ db, logger: silentLogger, includeSecrets: () => false })
    const ws = {
      agentId: AGENT.id, rootPath: '/tmp/colleague',
      identity: file('IDENTITY.md', '## My mission\nhelp'),
      soulMd: file('SOUL.md', '## [Internal Voice]\n## [External Voice]'),
      soulStyleJson: file('SOUL.style.json', '{}'),
      agentsMd: file('AGENTS.md', ''), toolsMd: file('TOOLS.md', ''), memoryMd: file('MEMORY.md', ''),
      dailyMemory: [],
    }
    assembler = createPromptAssembler({
      workspaceLoader: { load: async () => ws as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ channel: 'unknown', os: 'linux' }),
      resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
      resolveDeliveryProfile: () => PROFILE,
      resolveMemoryRecallChars: () => 8_000,
      resolveRecall: (input) => recall(input),
      resolveClock: () => ({ date: '2031-02-03', time: '04:05' }),
    })
  })

  afterEach(() => testDb.cleanup())

  // ── Entry paths ──────────────────────────────────────────────────────────

  async function interactive(): Promise<void> {
    const reg = createPermissionRegistry()
    reg.registerSubject('Conversation', { actions: ['read', 'update', 'create', 'delete'], defaults: { admin: [], owner: ['read', 'update', 'create', 'delete'], user: [], agent: [], guest: [] } })
    reg.registerSubject('ConversationMessage', { actions: ['read', 'create'], defaults: { admin: [], owner: ['read', 'create'], user: [], agent: [], guest: [] } })
    const ability = buildAbilityForRole('owner', reg)
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    const gateway = createModelGateway()
    gateway.registerProvider({
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream() { throw new Error('the runner answers this path') },
    } as any)
    createConversationRoutes(
      app as any, chat, gateway, createProviderConfigService(db),
      undefined, () => captureRunner('interactive') as any, () => toolRegistry as any, undefined, () => assembler,
      undefined, undefined, undefined, undefined, undefined, undefined,
      () => recorder('interactive') as any,
    )
    const id = conversation({ goalDescription: null })
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: TEXT, provider: 'p1', model: 'm1' }),
    })
    expect(res.status, await res.clone().text()).toBe(200)
    await res.text()
  }

  async function background(label: string, over: Record<string, unknown> = {}): Promise<void> {
    const id = conversation(over)
    const result = await runConversation(id, {
      db, agentRunner: captureRunner(label), agentRegistry, toolRegistry, logger: silentLogger,
      promptAssembler: assembler, contextRecorder: recorder(label) as any,
    })
    expect(result.ran).toBe(true)
  }

  async function botExecutor(): Promise<void> {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, bot_listen, created_at) VALUES ('stage-bot', ${PROJECT}, 'Bot', 0, 1, ${now})`)
    conversation({ stageId: 'stage-bot', status: 'waiting', mode: 'managed' })
    // I10: the executor runs cards through the shared runner entry.
    const agentRunner = captureRunner('bot-executor')
    const botRecorder = recorder('bot-executor')
    const executor = createBotExecutor({
      db,
      logger: silentLogger,
      runConversation: (id, overrides) => runConversation(id, {
        db, agentRunner, agentRegistry, toolRegistry, logger: silentLogger,
        promptAssembler: assembler, contextRecorder: botRecorder as any,
      }, overrides),
    })
    expect(await executor.processWaiting()).toBe(1)
  }

  async function bootAgentModule(): Promise<any> {
    const ctx: any = {
      db: createMemoryDb(),
      bus: { emit: () => {}, on: () => {}, off: () => {} },
      logger: silentLogger,
      model: {},
      permissions: { registerSubject: () => {} },
      hasModule: () => false,
      http: { get: () => {}, post: () => {}, use: () => {} },
    }
    await agentModule.onRegister!(ctx)
    ctx.promptAssembler = assembler
    ctx.conversations = chat
    ctx.contextRecorder = recorder('executeAgent')
    ctx.agents.registry.create({
      id: AGENT.id, name: AGENT.name, role: 'tester', description: 'd', goal: 'g', backstory: 'b',
      systemPrompt: 'sp', capabilities: [], tools: [], constraints: [], model: 'm1',
    })
    return ctx
  }

  async function executeAgent(opts?: { origin?: 'pipeline' | 'delegation'; audience?: 'owner' | 'external' }): Promise<void> {
    const ctx = await bootAgentModule()
    const id = conversation({ goalDescription: null })
    const out = await ctx.agents.executeAgent(id, AGENT.id, TEXT, opts)
    expect(out.status).toBe('completed')
  }

  async function teamMember(): Promise<void> {
    const parent = conversation()
    const orchestrator = createOrchestrator({
      agentRegistry: agentRegistry as any, agentRunner: captureRunner('team-member') as any,
      conversations: chat, toolRegistry: toolRegistry as any, toolExecutor: {} as any,
      promptAssembler: assembler, contextRecorder: recorder('team-member') as any,
    } as any)
    await orchestrator.runAgentInConversation(AGENT.id, parent, TEXT)
  }

  async function channel(scope: 'internal' | 'external'): Promise<void> {
    const id = conversation({ goalDescription: null })
    chat.addMessage(id, { role: 'user', content: wrapUntrusted(TEXT, { source: 'telegram' }) })
    const runAgent = createChannelRunAgent({
      agentRegistry, agentRunner: captureRunner('channel'), conversations: chat, toolRegistry, logger: silentLogger,
      promptAssembler: assembler, contextRecorder: recorder('channel'),
      resolveVoiceScope: async () => scope,
    })
    await runAgent({ conversationId: id, agentId: AGENT.id, mode: 'managed' })
  }

  // ── What each path delivered ─────────────────────────────────────────────

  function recallSection(label: string) {
    const rec = recorded.filter((r) => r.label === label).at(-1)
    expect(rec, `${label} recorded no composition`).toBeDefined()
    return (rec!.input.sections as any[]).find((s) => s.key === 'memory-recall')
  }

  function idsOf(label: string): string[] {
    const section = recallSection(label)
    expect(section, `${label} recorded no memory-recall section`).toBeDefined()
    expect(section.zone).toBe('turn')
    return String(section.sourceRef ?? '').split(',').filter(Boolean).sort()
  }

  function turnOf(label: string): string {
    const run = mocked.runs.filter((r) => r.label === label).at(-1)
    expect(run, `${label} never reached a runner`).toBeDefined()
    return String(run!.opts.turn ?? run!.opts.systemPrompt?.turn ?? '')
  }

  it('(+) interactive, background, God Mode worker, board bot, executeAgent (specialist / pipeline), team member and owner-voice channel get the same recall', async () => {
    await interactive()
    await background('background')
    // A God Mode worker is a child conversation run through the same runner entry.
    await background('god-mode-worker', { parentConversationId: conversation() })
    await botExecutor()
    await executeAgent()
    const specialistIds = idsOf('executeAgent')
    recorded = recorded.filter((r) => r.label !== 'executeAgent')
    await executeAgent({ origin: 'pipeline' })
    await teamMember()
    await channel('internal')

    const reference = idsOf('interactive')
    // Retrieved v2 prior work and the standing note.
    expect(reference.some((id) => id.startsWith('gs:'))).toBe(true)
    expect(reference.some((id) => id.startsWith('vt:'))).toBe(true)
    // Scope is the conversation's project: the other office's work never shows.
    expect(reference.some((id) => id.includes('away1'))).toBe(false)

    expect(specialistIds).toEqual(reference)
    for (const label of ['interactive', 'background', 'god-mode-worker', 'bot-executor', 'executeAgent', 'team-member', 'channel']) {
      // Every composition records the window the prompt was sized for.
      const rec = recorded.filter((r) => r.label === label).at(-1)!.input
      expect(rec.contextWindow, label).toBe(100_000)
      expect(rec.budgetTotalTokens, label).toBeGreaterThan(0)
    }
    for (const label of ['background', 'god-mode-worker', 'bot-executor', 'executeAgent', 'team-member', 'channel']) {
      expect(idsOf(label), label).toEqual(reference)
      const turn = turnOf(label)
      expect(turn, label).toContain('<turn-context>')
      expect(turn, label).toContain('<eyas-memory')
      expect(turn, label).toContain('Current date and time: 2031-02-03 04:05')
    }
    // The interactive turn goes to the runner the same way, never into the system prompt.
    expect(turnOf('interactive')).toContain('<eyas-memory')
    const interactiveRun = mocked.runs.find((r) => r.label === 'interactive')!.opts
    expect(String(interactiveRun.system ?? '')).not.toContain('<eyas-memory')
  })

  it('(+) a board-bot run gets v2 ids (gs:), not a legacy index alone', async () => {
    await botExecutor()
    const ids = idsOf('bot-executor')
    expect(ids.some((id) => id.startsWith('gs:'))).toBe(true)
  })

  it('(−) an A2A peer task: recall withheld, the clock still there', async () => {
    await executeAgent({ origin: 'delegation', audience: 'external' })
    expect(recallSection('executeAgent')).toBeUndefined()
    const turn = turnOf('executeAgent')
    expect(turn).toContain('Current date and time: 2031-02-03 04:05')
    expect(turn).not.toContain('<eyas-memory')
    expect(turn).not.toContain('Ledger figures are always in EUR')
  })

  it('(−) an external-voice channel reply: recall withheld, the clock still there', async () => {
    await channel('external')
    expect(recallSection('channel')).toBeUndefined()
    const turn = turnOf('channel')
    expect(turn).toContain('Current date and time')
    expect(turn).not.toContain('<eyas-memory')
  })

  it('(−) a channel whose voice scope cannot be resolved answers without recall (fail closed)', async () => {
    const id = conversation({ goalDescription: null })
    chat.addMessage(id, { role: 'user', content: TEXT })
    const runAgent = createChannelRunAgent({
      agentRegistry, agentRunner: captureRunner('channel'), conversations: chat, toolRegistry, logger: silentLogger,
      promptAssembler: assembler, contextRecorder: recorder('channel'),
      resolveVoiceScope: async () => { throw new Error('override store down') },
    })
    await runAgent({ conversationId: id, agentId: AGENT.id, mode: 'managed' })
    expect(recallSection('channel')).toBeUndefined()
    expect(turnOf('channel')).not.toContain('<eyas-memory')
  })

  it('(−) the module wiring asks for it: A2A peer tasks run with an external audience, channel replies resolve their voice scope', async () => {
    // The two paths above are exercised directly; this pins that the
    // communication module actually passes what they depend on.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/modules/communication/index.ts', 'utf-8')
    const a2a = source.slice(source.indexOf('agents.executeAgent('), source.indexOf('agents.executeAgent(') + 240)
    expect(a2a).toContain("audience: 'external'")
    expect(source).toMatch(/resolveVoiceScope:\s*async/)
  })
})
