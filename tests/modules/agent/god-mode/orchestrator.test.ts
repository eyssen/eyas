// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createGodModeStore } from '@modules/agent/god-mode/store'
import { ensureGodModeSchema } from '@modules/agent/god-mode/schema'
import {
  createGodModeOrchestrator,
  failInFlightGodRuns,
  GodModeBusyError,
  GodModeCeilingError,
  GodModeConfigError,
} from '@modules/agent/god-mode/orchestrator'
import { bootGodMode, collectGodModeSourceRoots, gcExpiredGodWorkspaces, sweepGodModeWorkspaces } from '@modules/agent/god-mode/boot'
import type { ConversationRunnerDeps, RunConversationResult } from '@modules/agent/conversation-runner'
import type { ModelGateway, ModelRequest, ModelResponse } from '@modules/model/types'
import type { GodModeParticipantSpec } from '@modules/agent/god-mode/types'

const testDb = createTestDb('god-mode-orchestrator')
const temps: string[] = []

const roster: GodModeParticipantSpec[] = [
  { id: 'a', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
  { id: 'b', providerId: 'openai', modelId: 'gpt-4o' },
  { id: 'c', providerId: 'xai', modelId: 'grok-4' },
]

const liveKeys = new Set(roster.map((p) => `${p.providerId}/${p.modelId}`))
const limits = { min: 2, max: 5 }

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function writeFile(root: string, rel: string, contents: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

function reviewResponse(voteFor: string, insight = 'peer note', costUsd = 0): ModelResponse {
  return {
    id: 'review',
    provider: 'test',
    model: 'test',
    content: [{
      type: 'text',
      text: JSON.stringify({
        voteFor,
        scores: { quality: 4, completeness: 4, risk: 2 },
        uniqueInsights: [insight],
        risks: [],
        summary: `vote ${voteFor}`,
      }),
    }],
    stopReason: 'end',
    usage: { inputTokens: 8, outputTokens: 16, costUsd },
  }
}

function parseReviewerSlot(req: ModelRequest): string {
  const text = typeof req.messages[0]?.content === 'string' ? req.messages[0].content : ''
  const match = text.match(/Your slot is (\w+)/)
  return match?.[1] ?? ''
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let db: ReturnType<typeof testDb.open>
let conversations: ReturnType<typeof createConversationService>
let store: ReturnType<typeof createGodModeStore>

beforeEach(() => {
  db = testDb.open()
  conversations = createConversationService(db)
  store = createGodModeStore(db)
  store.saveConfig({
    participants: roster,
    chairParticipantId: 'a',
    costCeilingUsd: null,
    workspaceRetentionHours: 72,
  }, liveKeys, limits)
})

afterEach(() => {
  testDb.cleanup()
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function seedParent() {
  return conversations.create({ userId: 'owner-1', title: 'God parent' })
}

function makeGateway(voteFor: (slotId: string) => string, insight?: string, costUsd = 0): ModelGateway {
  return {
    complete: async (req: ModelRequest) => reviewResponse(voteFor(parseReviewerSlot(req)), insight, costUsd),
  } as unknown as ModelGateway
}

function makeOrchestrator(opts: {
  runConversation: (
    conversationId: string,
    deps: ConversationRunnerDeps,
  ) => Promise<RunConversationResult>
  gateway?: ModelGateway
  eventStore?: ConversationRunnerDeps['eventStore']
  agentRegistry?: ConversationRunnerDeps['agentRegistry']
}) {
  return createGodModeOrchestrator({
    store,
    conversations,
    runConversation: opts.runConversation,
    runConversationDeps: {
      db,
      agentRunner: {},
      agentRegistry: opts.agentRegistry ?? {},
      toolRegistry: {},
      logger: silentLogger,
      eventStore: opts.eventStore,
    },
    gateway: opts.gateway ?? makeGateway((slot) => (slot === 'a' ? 'b' : 'a')),
    logger: silentLogger,
  })
}

function finishChild(childId: string, text: string, extra?: { costUsd?: number }): void {
  const child = conversations.get(childId)
  if (!child) throw new Error(`missing child ${childId}`)
  const slot = roster.find((p) => p.modelId === child.modelId)?.id ?? child.modelId ?? 'x'
  const workspace = child.workingDirectories?.[0]
  if (workspace) writeFile(workspace, 'winner.txt', `from-${slot}`)
  conversations.addMessage(childId, {
    role: 'assistant',
    content: text,
    model: child.modelId ?? undefined,
    provider: child.providerId ?? undefined,
    tokensIn: 11,
    tokensOut: 22,
  })
  conversations.addRunCost(childId, { costUsd: extra?.costUsd ?? 0.01 })
}

describe('createGodModeOrchestrator', () => {
  it('3 workers: majority vote for slot A and A’s files land in dest', async () => {
    const src = tempDir('eyas-god-maj-')
    writeFile(src, 'seed.txt', 'base')
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        finishChild(id, 'done')
        return { ran: true }
      },
      gateway: makeGateway((slot) => (slot === 'a' ? 'b' : 'a'), 'only-b-and-c'),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'ship it',
      sourceWorkingDirectory: src,
      orchestration: 'solo',
      liveKeys,
      limits,
    })

    expect(run.status).toBe('completed')
    const parts = store.listParticipants(run.id)
    const winner = parts.find((p) => p.id === run.winnerParticipantId)
    expect(winner?.slotId).toBe('a')
    expect(run.tieBroken).toBe(false)
    expect(run.decision?.method).toBe('majority')
    expect(run.decision?.winnerSlotId).toBe('a')
    expect(run.timeline.map((e) => e.key)).toEqual(expect.arrayContaining([
      'started', 'racing', 'worker-done', 'reviewing', 'decided', 'promoting', 'completed',
    ]))
    expect(parts.filter((p) => p.reviewSummary).length).toBeGreaterThan(0)
    expect(readFileSync(join(src, 'winner.txt'), 'utf8')).toBe('from-a')
    const parentAfter = conversations.get(parent.id)
    expect(parentAfter?.messages.some((m) => m.role === 'assistant' && m.content === 'done')).toBe(true)
  })

  it('1 worker returns ran:false and the other two still decide', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        if (child.modelId === 'claude-sonnet-4-6') {
          conversations.addRunCost(id, { costUsd: 0.01 })
          return { ran: false, reason: 'error' }
        }
        finishChild(id, `ok-${child.modelId}`)
        return { ran: true }
      },
      gateway: makeGateway((slot) => (slot === 'b' ? 'c' : 'b')),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'race',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    expect(run.status).toBe('completed')
    const parts = store.listParticipants(run.id)
    const failed = parts.find((p) => p.slotId === 'a')
    expect(failed?.status).toBe('failed')
    const winner = parts.find((p) => p.id === run.winnerParticipantId)
    expect(['b', 'c']).toContain(winner?.slotId)
    expect(parts.filter((p) => p.status === 'completed')).toHaveLength(2)
  })

  it('ceiling estimate too high throws before inserting a run', async () => {
    store.saveConfig({
      participants: roster,
      chairParticipantId: 'a',
      costCeilingUsd: 0.0001,
      workspaceRetentionHours: 72,
    }, liveKeys, limits)
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async () => {
        throw new Error('must not race')
      },
    })

    await expect(orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'too expensive',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })).rejects.toBeInstanceOf(GodModeCeilingError)

    expect(orch.listForConversation(parent.id)).toEqual([])
    const rows = db.all(sql`SELECT id FROM god_mode_runs`) as any[]
    expect(rows).toHaveLength(0)
  })

  it('second start while racing throws GodModeBusyError', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        await held
        finishChild(id, 'late')
        return { ran: true }
      },
    })

    const first = orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'first',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    await waitFor(() => orch.hasActiveRun(parent.id))
    await expect(orch.start({
      conversationId: parent.id,
      userMessageId: 2,
      userText: 'second',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })).rejects.toBeInstanceOf(GodModeBusyError)

    release()
    const run = await first
    expect(run.status).toBe('completed')
  })

  it('cancelActive during racing does not promote dest files', async () => {
    const src = tempDir('eyas-god-cancel-')
    writeFile(src, 'seed.txt', 'base')
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        await held
        finishChild(id, 'late')
        return { ran: true }
      },
    })

    const started = orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'cancel me',
      sourceWorkingDirectory: src,
      orchestration: 'solo',
      liveKeys,
      limits,
    })

    await waitFor(() => orch.hasActiveRun(parent.id))
    await waitFor(() => {
      const run = orch.listForConversation(parent.id)[0]
      return run?.status === 'racing'
    })
    const cancelled = await orch.cancelActive(parent.id)
    expect(cancelled?.status).toBe('cancelled')
    release()
    const run = await started
    expect(run.status).toBe('cancelled')
    expect(existsSync(join(src, 'winner.txt'))).toBe(false)
  })

  it('empty source dir uses isolation none and still completes on transcripts', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        finishChild(id, 'transcript only')
        return { ran: true }
      },
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'q&a',
      sourceWorkingDirectory: null,
      orchestration: 'deep',
      liveKeys,
      limits,
    })

    expect(run.isolation).toBe('none')
    expect(run.status).toBe('completed')
    const parts = store.listParticipants(run.id)
    expect(parts.every((p) => p.workspacePath == null)).toBe(true)
    expect(parts.filter((p) => p.status === 'completed')).toHaveLength(3)
  })

  it('child conversations have godMode false', async () => {
    const parent = seedParent()
    const seen: boolean[] = []
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        seen.push(child.godMode)
        finishChild(id, 'ok')
        return { ran: true }
      },
    })

    await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'no recurse',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    expect(seen.length).toBe(3)
    expect(seen.every((g) => g === false)).toBe(true)
    const children = conversations.getChildren(parent.id)
    expect(children.every((c) => c.godMode === false)).toBe(true)
  })

  it('discards a self-vote so it does not elect that slot', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        if (child.modelId === 'claude-sonnet-4-6') {
          await new Promise((r) => setTimeout(r, 30))
        }
        finishChild(id, `ok-${child.modelId}`)
        return { ran: true }
      },
      // A votes for itself (discarded). B votes C, C votes B → tie → earliest of B/C.
      gateway: makeGateway((slot) => (slot === 'a' ? 'a' : slot === 'b' ? 'c' : 'b')),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'self vote',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    const winner = store.listParticipants(run.id).find((p) => p.id === run.winnerParticipantId)
    expect(winner?.slotId).not.toBe('a')
    expect(['b', 'c']).toContain(winner?.slotId)
    expect(run.tieBroken).toBe(true)
  })

  it('invalid roster throws GodModeConfigError with no run row', async () => {
    store.saveConfig({
      participants: [],
      chairParticipantId: null,
      costCeilingUsd: null,
      workspaceRetentionHours: 72,
    }, liveKeys, { min: 2, max: 5 })
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async () => ({ ran: true }),
    })

    await expect(orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'bad roster',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })).rejects.toBeInstanceOf(GodModeConfigError)

    expect(orch.listForConversation(parent.id)).toEqual([])
  })

  it('ran:false slot is failed and is not a completed voter', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        if (child.modelId === 'claude-sonnet-4-6') {
          return { ran: false, reason: 'error', error: 'API Error: 529 Overloaded' }
        }
        finishChild(id, `ok-${child.modelId}`)
        return { ran: true }
      },
      gateway: makeGateway((slot) => (slot === 'b' ? 'c' : 'b')),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'ran false',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    const parts = store.listParticipants(run.id)
    const a = parts.find((p) => p.slotId === 'a')
    expect(a?.status).toBe('failed')
    expect(a?.error).toBe('API Error: 529 Overloaded')
    expect(a?.voteFor).toBeNull()
    expect(parts.filter((p) => p.status === 'completed')).toHaveLength(2)
    const winner = parts.find((p) => p.id === run.winnerParticipantId)
    expect(winner?.slotId).not.toBe('a')
  })

  it('parked slot is not a completed voter', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        if (child.modelId === 'claude-sonnet-4-6') return { ran: true, parked: true, sessionId: 'parked-a' }
        finishChild(id, `ok-${child.modelId}`)
        return { ran: true }
      },
      gateway: makeGateway((slot) => (slot === 'b' ? 'c' : 'b')),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'parked',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    const parts = store.listParticipants(run.id)
    const a = parts.find((p) => p.slotId === 'a')
    expect(a?.status).not.toBe('completed')
    expect(a?.error).toBe('parked')
    expect(a?.voteFor).toBeNull()
    expect(parts.filter((p) => p.status === 'completed')).toHaveLength(2)
    const winner = parts.find((p) => p.id === run.winnerParticipantId)
    expect(winner?.slotId).not.toBe('a')
  })

  it('updates the child with the parent agentId', async () => {
    const parent = seedParent()
    conversations.update(parent.id, { agentId: 'agent-primary' })
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        finishChild(id, 'ok')
        return { ran: true }
      },
    })

    await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'agent',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    const children = conversations.getChildren(parent.id)
    expect(children.length).toBe(3)
    expect(children.every((c) => c.agentId === 'agent-primary')).toBe(true)
  })

  it('harvests the winner text from the event store, not conversation_messages', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        const child = conversations.get(id)!
        const slot = roster.find((p) => p.modelId === child.modelId)!.id
        conversations.addRunCost(id, { costUsd: 0.01 })
        return { ran: true, sessionId: `sess-${slot}` }
      },
      eventStore: {
        getByTypes: async (sessionId: string) => [{
          payload: { response: { content: `harvested-${sessionId.replace('sess-', '')}` } },
        }],
      } as any,
      gateway: makeGateway((slot) => (slot === 'a' ? 'b' : 'a')),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'harvest',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    const winner = store.listParticipants(run.id).find((p) => p.id === run.winnerParticipantId)
    expect(winner?.slotId).toBe('a')
    expect(winner?.summary).toBe('harvested-a')
    const parentAfter = conversations.get(parent.id)
    expect(parentAfter?.messages.some((m) => m.role === 'assistant' && m.content === 'harvested-a')).toBe(true)
    expect(parentAfter?.messages.every((m) => m.content !== '')).toBe(true)
  })

  it('review prompt for copy isolation lists changed rel paths, not the whole tree', async () => {
    const src = tempDir('eyas-god-review-')
    writeFile(src, 'seed.txt', 'base')
    writeFile(src, 'untouched.txt', 'keep')
    const prompts: string[] = []
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        finishChild(id, 'done')
        return { ran: true }
      },
      gateway: {
        complete: async (req: ModelRequest) => {
          const text = typeof req.messages[0]?.content === 'string' ? req.messages[0].content : ''
          prompts.push(text)
          return reviewResponse(parseReviewerSlot(req) === 'a' ? 'b' : 'a')
        },
      } as unknown as ModelGateway,
    })

    await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'diff only',
      sourceWorkingDirectory: src,
      orchestration: 'solo',
      liveKeys,
      limits,
    })

    expect(prompts.length).toBeGreaterThan(0)
    const joined = prompts.join('\n')
    expect(joined).toContain('winner.txt')
    expect(joined).not.toMatch(/Changes:\n[\s\S]*untouched\.txt/)
    expect(joined).not.toMatch(/Changes:\n[\s\S]*seed\.txt/)
  })

  it('includes review usage.costUsd in the run rollup', async () => {
    const parent = seedParent()
    const orch = makeOrchestrator({
      runConversation: async (id) => {
        finishChild(id, 'ok', { costUsd: 0.01 })
        return { ran: true }
      },
      gateway: makeGateway((slot) => (slot === 'a' ? 'b' : 'a'), 'note', 1.25),
    })

    const run = await orch.start({
      conversationId: parent.id,
      userMessageId: 1,
      userText: 'cost',
      sourceWorkingDirectory: null,
      orchestration: 'auto',
      liveKeys,
      limits,
    })

    // 3 workers * 0.01 + 3 reviews * 1.25
    expect(run.totalCostUsd).toBeCloseTo(0.03 + 3.75, 5)
  })
})

describe('failInFlightGodRuns', () => {
  it('flips a racing row to failed with process restarted', () => {
    const now = new Date().toISOString()
    db.run(sql`
      INSERT INTO god_mode_runs (
        id, conversation_id, user_message_id, status, winner_participant_id,
        tie_broken, chair_participant_id, participants_snapshot, isolation,
        source_working_directory, total_tokens, total_cost_usd, duration_ms,
        error, created_at, completed_at
      ) VALUES (
        'run-racing', 'conv-1', 1, 'racing', NULL,
        0, 'a', ${JSON.stringify(roster)}, 'none',
        NULL, 0, 0, 0,
        NULL, ${now}, NULL
      )
    `)

    const n = failInFlightGodRuns(db)
    expect(n).toBe(1)
    const row = (db.all(sql`SELECT status, error, completed_at FROM god_mode_runs WHERE id = 'run-racing'`) as any[])[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe('process restarted')
    expect(typeof row.completed_at).toBe('string')
  })
})

describe('boot GC roots', () => {
  it('collectGodModeSourceRoots returns distinct non-null source dirs', () => {
    const now = new Date().toISOString()
    db.run(sql`
      INSERT INTO god_mode_runs (
        id, conversation_id, user_message_id, status, tie_broken,
        chair_participant_id, participants_snapshot, isolation,
        source_working_directory, total_tokens, total_cost_usd, duration_ms, created_at
      ) VALUES
        ('r1', 'c1', 1, 'completed', 0, NULL, '[]', 'copy', '/tmp/alpha', 0, 0, 0, ${now}),
        ('r2', 'c2', 1, 'completed', 0, NULL, '[]', 'copy', '/tmp/alpha', 0, 0, 0, ${now}),
        ('r3', 'c3', 1, 'completed', 0, NULL, '[]', 'none', NULL, 0, 0, 0, ${now}),
        ('r4', 'c4', 1, 'completed', 0, NULL, '[]', 'copy', '/tmp/beta', 0, 0, 0, ${now})
    `)
    const roots = collectGodModeSourceRoots(db).sort()
    expect(roots).toEqual(['/tmp/alpha', '/tmp/beta'])
  })

  it('bootGodMode fails in-flight runs then GCs stale trees using DB roots', () => {
    const src = tempDir('eyas-god-boot-')
    const stale = join(src, '.eyas-god', 'old-run')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'leftover.txt'), 'gone')
    const past = new Date(Date.now() - 86_400_000)
    utimesSync(stale, past, past)

    const now = new Date().toISOString()
    db.run(sql`
      INSERT INTO god_mode_runs (
        id, conversation_id, user_message_id, status, tie_broken,
        chair_participant_id, participants_snapshot, isolation,
        source_working_directory, total_tokens, total_cost_usd, duration_ms, created_at
      ) VALUES (
        'inflight', 'c1', 1, 'racing', 0, NULL, '[]', 'copy',
        ${src}, 0, 0, 0, ${now}
      )
    `)

    const result = bootGodMode(db, { retentionHours: 1 })
    expect(result.failed).toBe(1)
    expect(result.gcRemoved).toBeGreaterThanOrEqual(1)
    const row = (db.all(sql`SELECT status, error FROM god_mode_runs WHERE id = 'inflight'`) as any[])[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe('process restarted')
  })

  it('exports gcExpiredGodWorkspaces and sweep does not fail in-flight runs', () => {
    expect(typeof gcExpiredGodWorkspaces).toBe('function')
    expect(typeof sweepGodModeWorkspaces).toBe('function')

    const src = tempDir('eyas-god-sweep-')
    const stale = join(src, '.eyas-god', 'old-run')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'leftover.txt'), 'gone')
    const past = new Date(Date.now() - 86_400_000)
    utimesSync(stale, past, past)

    const now = new Date().toISOString()
    db.run(sql`
      INSERT INTO god_mode_runs (
        id, conversation_id, user_message_id, status, tie_broken,
        chair_participant_id, participants_snapshot, isolation,
        source_working_directory, total_tokens, total_cost_usd, duration_ms, created_at
      ) VALUES (
        'still-racing', 'c-sweep', 1, 'racing', 0, NULL, '[]', 'copy',
        ${src}, 0, 0, 0, ${now}
      )
    `)

    const swept = sweepGodModeWorkspaces(db, { getConfig: () => ({ workspaceRetentionHours: 1 }) })
    expect(swept.gcRemoved).toBeGreaterThanOrEqual(1)
    const row = (db.all(sql`SELECT status, error FROM god_mode_runs WHERE id = 'still-racing'`) as any[])[0]
    expect(row.status).toBe('racing')
    expect(row.error).toBeNull()
    expect(existsSync(stale)).toBe(false)
  })
})

describe('ensureGodModeSchema insights column', () => {
  it('adds insights on god_mode_runs', () => {
    ensureGodModeSchema(db)
    const cols = (db.all(sql.raw('PRAGMA table_info(god_mode_runs)')) as any[]).map((c) => c.name)
    expect(cols).toContain('insights')
  })
})
