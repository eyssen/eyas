// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// W5 — the durable-fact pass (F1) runs on every entry path, through the one
// entry the interactive turn and the background runner use
// (memory/capture/run-end.ts → ctx.memoryCapture). Delegated, specialist,
// pipeline and A2A runs (executeAgent), team members and channel replies used
// to skip it silently. Each path is driven for real here, with a scripted
// runner; the capture is a spy (what each path hands over), and then the REAL
// capture pipeline (the same gate, cap and run row everywhere). Fictive
// projects, agents and messages.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'

const mocked = vi.hoisted(() => ({
  /** executeAgent's runner answers with this script. */
  script: { text: 'ok' as string, throwPartial: undefined as string | undefined },
}))

// executeAgent builds its runner inside the agent module.
vi.mock('@modules/agent/agent-runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('@modules/agent/agent-runner')>()
  return {
    ...original,
    createAgentRunner: () => ({
      run: () => (async function* () {
        if (mocked.script.throwPartial !== undefined) {
          const err: any = new Error('provider gave up')
          err.partialText = mocked.script.throwPartial
          throw err
        }
        if (mocked.script.text) yield { type: 'text', text: mocked.script.text }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: 'm1', content: mocked.script.text ? [{ type: 'text', text: mocked.script.text }] : [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
          outcome: 'completed',
          stopReason: 'end',
        }
      })(),
    }),
  }
})

import { createTestDb, createMemoryDb, insertTestOwner } from '../../helpers/test-db'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { runConversation } from '@modules/agent/conversation-runner'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { agentModule } from '@modules/agent/index'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'
import { createMemoryCapture, type CaptureInput } from '@modules/memory/capture/index'
import type { CaptureConfig } from '@modules/memory/capture/capture-gate'
import { wrapUntrusted } from '@shared/untrusted'
import { silentLogger } from './v2/helpers'

const testDb = createTestDb('capture-entry-paths')

/** Every path's instruction: over the 40-character default gate. */
const TASK = 'Reconcile the harbor invoices against the quarterly ledger again'
const ANSWER = 'Reconciled: two mismatches, both port fees.'
const PROJECT = 'proj-harbor'

const AGENT = {
  id: 'colleague', name: 'Colleague', role: 'assistant', enabled: true, systemPrompt: 'You help.',
  tools: [] as string[], constraints: [] as string[], maxTurns: 3, model: 'm1',
}
const agentRegistry = {
  get: (id: string) => (id === AGENT.id ? AGENT : undefined),
  list: () => [AGENT],
  isWithinBudget: () => true,
  addTokenUsage: () => {},
}
const toolRegistry = { toToolDefinitions: () => [] }

/** A runner that answers `text` (nothing at all when empty). */
function scriptedRunner(text: string) {
  return {
    run: () => (async function* () {
      if (text) yield { type: 'text', text }
      yield {
        type: 'done',
        response: { id: 'r', provider: 'p1', model: 'm1', content: text ? [{ type: 'text', text }] : [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
        outcome: 'completed',
        stopReason: 'end',
      }
    })(),
  }
}

describe('F1 capture on every entry path (W5)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let captured: CaptureInput[]
  let spy: ReturnType<typeof vi.fn>

  function conversation(over: Record<string, unknown> = {}): string {
    const id = chat.create({ userId, title: 'Quarter close', providerId: 'p1', modelId: 'm1', projectId: PROJECT } as any).id
    chat.update(id, { agentId: AGENT.id, goalDescription: TASK, ...over } as any)
    return id
  }

  beforeEach(async () => {
    mocked.script.text = ANSWER
    mocked.script.throwPartial = undefined
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    captured = []
    spy = vi.fn(async (input: CaptureInput) => { captured.push(input) })
  })

  afterEach(() => testDb.cleanup())

  // ── The paths ────────────────────────────────────────────────────────────

  async function bootAgentModule(memoryCapture: unknown = spy): Promise<any> {
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
    ctx.conversations = chat
    // Published by the memory module after the agent module registered.
    ctx.memoryCapture = memoryCapture
    ctx.agents.registry.create({
      id: AGENT.id, name: AGENT.name, role: 'tester', description: 'd', goal: 'g', backstory: 'b',
      systemPrompt: 'sp', capabilities: [], tools: [], constraints: [], model: 'm1',
    })
    return ctx
  }

  async function executeAgent(opts?: { origin?: 'pipeline' | 'delegation'; audience?: 'owner' | 'external' }, task = TASK, memoryCapture: unknown = spy) {
    const ctx = await bootAgentModule(memoryCapture)
    const id = conversation({ goalDescription: null })
    const out = await ctx.agents.executeAgent(id, AGENT.id, task, opts)
    return { id, out }
  }

  async function teamMember(answer = ANSWER, memoryCapture: unknown = spy) {
    const parent = conversation()
    const orchestrator = createOrchestrator({
      agentRegistry: agentRegistry as any, agentRunner: scriptedRunner(answer) as any,
      conversations: chat, toolRegistry: toolRegistry as any, toolExecutor: {} as any,
      memoryCapture,
    } as any)
    return orchestrator.runAgentInConversation(AGENT.id, parent, TASK)
  }

  async function channel(inbound = TASK, answer = ANSWER, memoryCapture: unknown = spy) {
    const id = conversation({ goalDescription: null })
    chat.addMessage(id, { role: 'user', content: wrapUntrusted(inbound, { source: 'telegram' }), author: 'peer', entryPath: 'channel' } as any)
    const runAgent = createChannelRunAgent({
      agentRegistry, agentRunner: scriptedRunner(answer), conversations: chat, toolRegistry, logger: silentLogger,
      memoryCapture: memoryCapture as any,
    })
    const out = await runAgent({ conversationId: id, agentId: AGENT.id, mode: 'managed' })
    return { id, out }
  }

  /**
   * A card run. The runner stores no message of its own, so the exchange it
   * captures is the stored one: `userText`, then an earlier answer.
   */
  async function background(over: Record<string, unknown> = {}, userText?: string) {
    const id = conversation(over)
    if (userText !== undefined) {
      chat.addMessage(id, { role: 'user', content: userText } as any)
      chat.addMessage(id, { role: 'assistant', content: ANSWER } as any)
    }
    const result = await runConversation(id, {
      db, agentRunner: scriptedRunner(ANSWER), agentRegistry, toolRegistry, logger: silentLogger,
      memoryCapture: spy as any,
    } as any)
    expect(result.ran).toBe(true)
    return id
  }

  // ── What each path hands over ────────────────────────────────────────────

  describe('delegated and specialist runs (executeAgent)', () => {
    it('hands the task and the answer over as agent-authored, on the delegation path', async () => {
      const { id } = await executeAgent()
      expect(captured).toEqual([{
        conversationId: id, projectId: PROJECT, userMessage: TASK, assistantMessage: ANSWER,
        author: 'agent', entryPath: 'delegation',
      }])
    })

    it('keeps a pipeline stage on its own entry path', async () => {
      await executeAgent({ origin: 'pipeline' })
      expect(captured[0]).toMatchObject({ author: 'agent', entryPath: 'pipeline' })
    })

    it('hands an A2A task over as a peer\'s, never the owner\'s', async () => {
      const fenced = wrapUntrusted(TASK, { source: 'a2a' })
      await executeAgent({ origin: 'delegation', audience: 'external' }, fenced)
      expect(captured[0]).toMatchObject({ userMessage: fenced, author: 'peer', entryPath: 'a2a' })
    })

    it('captures the partial answer of a run the provider gave up on', async () => {
      mocked.script.throwPartial = 'Half-way: the first mismatch is a port fee.'
      const { out } = await executeAgent()
      expect(out.status).toBe('failed')
      expect(captured).toHaveLength(1)
      expect(captured[0].assistantMessage).toBe('Half-way: the first mismatch is a port fee.')
    })

    it('hands nothing over when the run answered nothing (negative)', async () => {
      mocked.script.text = ''
      await executeAgent()
      expect(spy).not.toHaveBeenCalled()
    })

    it('finishes the run when the capture rejects, or when none is wired (negative)', async () => {
      const rejecting = vi.fn().mockRejectedValue(new Error('vault on fire'))
      await expect(executeAgent(undefined, TASK, rejecting)).resolves.toMatchObject({ out: { status: 'completed' } })
      expect(rejecting).toHaveBeenCalledTimes(1)
      await expect(executeAgent(undefined, TASK, undefined)).resolves.toMatchObject({ out: { status: 'completed' } })
    })
  })

  describe('team member runs', () => {
    it('hands the brief and the member\'s answer over as agent-authored, on the team path', async () => {
      const member = await teamMember()
      expect(member.status).toBe('completed')
      expect(captured).toEqual([{
        conversationId: member.conversationId, projectId: PROJECT, userMessage: TASK, assistantMessage: ANSWER,
        author: 'agent', entryPath: 'team',
      }])
    })

    it('hands nothing over when the member answered nothing (negative)', async () => {
      await teamMember('')
      expect(spy).not.toHaveBeenCalled()
    })

    it('completes the member when the capture rejects, or when none is wired (negative)', async () => {
      await expect(teamMember(ANSWER, vi.fn().mockRejectedValue(new Error('vault on fire')))).resolves.toMatchObject({ status: 'completed' })
      await expect(teamMember(ANSWER, undefined)).resolves.toMatchObject({ status: 'completed' })
    })
  })

  describe('channel replies', () => {
    it('hands the stored inbound message and the reply over as a peer\'s, on the channel path', async () => {
      const { id, out } = await channel()
      expect(out.replyText).toBe(ANSWER)
      expect(captured).toEqual([{
        conversationId: id, projectId: PROJECT, userMessage: wrapUntrusted(TASK, { source: 'telegram' }), assistantMessage: ANSWER,
        author: 'peer', entryPath: 'channel',
      }])
    })

    it('hands nothing over when the reply is empty (negative)', async () => {
      await channel(TASK, '')
      expect(spy).not.toHaveBeenCalled()
    })

    it('still replies when the capture rejects (negative)', async () => {
      const { out } = await channel(TASK, ANSWER, vi.fn().mockRejectedValue(new Error('vault on fire')))
      expect(out.replyText).toBe(ANSWER)
    })
  })

  describe('background runs: the author of the message it reads', () => {
    it('a hand-off brief (the stored message IS the goal) is agent-authored', async () => {
      await background({}, TASK)
      expect(captured[0]).toMatchObject({ userMessage: TASK, author: 'agent', entryPath: 'background' })
    })

    it('a message in a sub-conversation is agent-authored', async () => {
      const parent = conversation()
      await background({ parentConversationId: parent }, 'Also check the port fee export for March.')
      expect(captured[0]).toMatchObject({ author: 'agent', entryPath: 'background' })
    })

    it('a stored channel message is a peer\'s', async () => {
      const inbound = wrapUntrusted('Please send the ledger to the harbor office by Friday.', { source: 'email' })
      await background({}, inbound)
      expect(captured[0]).toMatchObject({ userMessage: inbound, author: 'peer' })
    })

    it('the owner\'s own chat message on the card stays the owner\'s (positive)', async () => {
      await background({}, 'I always want the ledger totals in EUR.')
      expect(captured[0]).toMatchObject({ author: 'owner', entryPath: 'background' })
    })
  })

  // ── The real pipeline behind the entry: one gate, one cap, one row ──────

  describe('through the real capture pipeline', () => {
    let memDb: any, root: string, complete: any, config: CaptureConfig, capture: (input: CaptureInput) => Promise<void>

    const rows = () => memDb.all(sql`SELECT entry_path, skipped_reason, notes_written FROM memory_capture_runs ORDER BY id ASC`) as any[]

    beforeEach(() => {
      memDb = createMemoryDb()
      createMemoryTables(memDb)
      root = mkdtempSync(join(tmpdir(), 'eyas-capture-paths-'))
      const vault = createVaultService(root)
      const wikilinks = createWikilinkService(memDb); wikilinks.init()
      const writer = createNoteWriter({ db: memDb, vault, indexer: createVaultIndexer(memDb, vault, wikilinks) })
      complete = vi.fn().mockResolvedValue({ ok: true, text: '{"notes":[]}', provider: 'openai', model: 'gpt-5-mini', route: 'api', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' })
      config = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }
      capture = createMemoryCapture({ db: memDb, config: () => config, complete, writer, logger: { warn: vi.fn(), debug: vi.fn() } })
    })

    afterEach(() => { rmSync(root, { recursive: true, force: true }) })

    it('leaves one run row per path, each naming its entry path', async () => {
      await executeAgent(undefined, TASK, capture)
      await executeAgent({ origin: 'pipeline' }, TASK, capture)
      await executeAgent({ origin: 'delegation', audience: 'external' }, wrapUntrusted(TASK, { source: 'a2a' }), capture)
      await teamMember(ANSWER, capture)
      await channel(TASK, ANSWER, capture)
      await vi.waitFor(() => expect(rows()).toHaveLength(5))
      expect(rows().map((r) => r.entry_path).sort()).toEqual(['a2a', 'channel', 'delegation', 'pipeline', 'team'])
      expect(rows().every((r) => r.skipped_reason === null)).toBe(true)
      expect(complete).toHaveBeenCalledTimes(5)
    })

    it('reads each author as such: the agent section for composed tasks, the peer fence for a channel', async () => {
      await teamMember(ANSWER, capture)
      await channel(TASK, ANSWER, capture)
      await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
      const prompts: string[] = complete.mock.calls.map((c: any[]) => c[0].user)
      expect(prompts.find((p) => p.includes('The USER MESSAGE is a task instruction'))).toBeDefined()
      const peer = prompts.find((p) => p.includes('An external sender wrote the USER MESSAGE'))!
      expect(peer).toContain(`<untrusted-input source="telegram">\n${TASK}\n</untrusted-input>`)
    })

    it('applies the same gate on every path: a short instruction spends no model call (negative)', async () => {
      await executeAgent(undefined, 'Fix it.', capture)
      await channel('ok', ANSWER, capture)
      await vi.waitFor(() => expect(rows()).toHaveLength(2))
      expect(rows().map((r) => r.skipped_reason)).toEqual(['too-short', 'too-short'])
      expect(complete).not.toHaveBeenCalled()
    })

    it('spends nothing on any path when the switch is off (negative)', async () => {
      config = { ...config, enabled: false }
      await executeAgent(undefined, TASK, capture)
      await teamMember(ANSWER, capture)
      await channel(TASK, ANSWER, capture)
      await new Promise((r) => setTimeout(r, 20))
      expect(rows()).toEqual([])
      expect(complete).not.toHaveBeenCalled()
    })

    it('holds a channel conversation to the same per-conversation cap', async () => {
      config = { ...config, maxPerConversation: 1 }
      const { id } = await channel(TASK, ANSWER, capture)
      await vi.waitFor(() => expect(rows()).toHaveLength(1))
      chat.addMessage(id, { role: 'user', content: wrapUntrusted(TASK, { source: 'telegram' }), author: 'peer', entryPath: 'channel' } as any)
      const runAgent = createChannelRunAgent({
        agentRegistry, agentRunner: scriptedRunner(ANSWER), conversations: chat, toolRegistry, logger: silentLogger, memoryCapture: capture,
      })
      await runAgent({ conversationId: id, agentId: AGENT.id, mode: 'managed' })
      await vi.waitFor(() => expect(rows()).toHaveLength(2))
      expect(rows().map((r) => r.skipped_reason)).toEqual([null, 'cap-reached'])
      expect(complete).toHaveBeenCalledTimes(1)
    })
  })
})
