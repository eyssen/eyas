// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T4 — team member runs (orchestrator.runAgentInConversation) are now
// SUPERVISED: each gets an agent_sessions row (kind='team'), the sessionId
// threaded into agentRunner.run() activates checkpoint + event-store capture,
// and the handle's AbortSignal lets an operator cancel abort the member. The
// returned member status is now real ('failed' on a throw or on max_turns),
// not the previous hardcoded 'completed'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOrchestrator, gcOrphanedWorktrees, removeWorktree, __getLiveWorktreeCountForTest } from '@modules/agent/orchestrator'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { createCheckpointTables, createCheckpointServices } from '@modules/agent/checkpoint'
import type { ModelGateway, ModelResponse, ContentBlock } from '@modules/model/types'

function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string, id = 'tu'): ModelResponse {
  const content: ContentBlock[] = [{ type: 'tool_use', id, name, input: { q: 'x' } }]
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 3 } }
}
function gatewayOf(responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[i++] ?? makeText('done')),
    async *stream() { yield { type: 'done', response: responses[i++] ?? makeText('done') } },
  } as unknown as ModelGateway
}

function makeRegistry(overrides: Partial<{ maxTurns: number }> = {}) {
  return {
    get: vi.fn().mockReturnValue({
      id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
      model: 'test-model', systemPrompt: 's', constraints: [], tools: [],
      maxTurns: overrides.maxTurns ?? 5,
    }),
    addTokenUsage: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  }
}

function makeConversations(childId = 'child-1') {
  return { create: vi.fn().mockReturnValue({ id: childId }), update: vi.fn(), addMessage: vi.fn() }
}

/** Real agentRunner wired to real checkpoint/event-store services (Cap 3 keystone pattern). */
function makeRealDeps(responses: ModelResponse[], childId = 'child-1', maxTurns = 5) {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  createEventStoreTables(db)
  createCheckpointTables(db)
  const events = createEventStore(db)
  const checkpoints = createCheckpointServices(db, { eventStore: events, policy: { everyTurns: 1 } })
  const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: 1 }, durationMs: 1 })) }
  const gateway = gatewayOf(responses)
  const agentRunner = createAgentRunner({ gateway, toolExecutor, eventStore: events, checkpoint: checkpoints.api } as any)
  const supervisor = createRunSupervisor({ db })
  const registry = makeRegistry({ maxTurns })
  const conversations = makeConversations(childId)
  const orchestrator = createOrchestrator({
    agentRegistry: registry as any,
    agentRunner,
    gateway: gateway as any,
    conversations: conversations as any,
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
    toolExecutor: toolExecutor as any,
    supervisor,
  })
  return { db, orchestrator, events, checkpoints, conversations }
}

describe('orchestrator supervision — team member runs (F2 T4)', () => {
  it('creates a supervised agent_sessions row (kind=team), records checkpoints + LlmResponse events, and resolves completed', async () => {
    const { db, orchestrator, events, checkpoints } = makeRealDeps([makeToolUse('search_memory'), makeText('final answer')])

    const result = await orchestrator.runAgentInConversation('a1', 'parent-conv', 'goal', false)

    const rows = db.all(sql`SELECT * FROM agent_sessions WHERE conversation_id = 'child-1'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('team')
    expect(rows[0].status).toBe('completed')
    expect(result.status).toBe('completed')

    const sessionId = rows[0].id
    const llm = await events.getByTypes(sessionId, ['LlmResponse'])
    expect(llm.length).toBeGreaterThan(0)
    const cpList = await checkpoints.api.list(sessionId)
    expect(cpList.length).toBeGreaterThan(0)
  })

  it('finalizes the row failed and rethrows when the member run throws (e.g. a provider error)', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const runner = { run: vi.fn(() => (async function* () { throw new Error('provider exploded') })()) }
    const registry = makeRegistry()
    const conversations = makeConversations('child-err')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    await expect(orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)).rejects.toThrow('provider exploded')

    const row = (db.all(sql`SELECT * FROM agent_sessions WHERE conversation_id = 'child-err'`) as any[])[0]
    expect(row.status).toBe('failed')
    expect(row.error).toContain('provider exploded')
  })

  it('propagates the failed member status into executeTeam phase results (existing catch semantics unchanged)', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const runner = { run: vi.fn(() => (async function* () { throw new Error('boom') })()) }
    const registry = makeRegistry()
    const conversations = makeConversations('child-p1')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    const config = {
      phases: [{ name: 'p1', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false }],
      maxParallelAgents: 1, conflictStrategy: 'first-wins' as const,
      replanAfterPhase: false, modelRouting: 'auto' as const, useWorktrees: false,
    }
    const seen: any[] = []
    for await (const e of orchestrator.executeTeam(config, 'parent', 'goal', 'team-1')) seen.push(e)

    const completedEvent = seen.find((e) => e.type === 'agent_completed')
    expect(completedEvent.status).toBe('failed')
    const phaseCompleted = seen.find((e) => e.type === 'phase_completed')
    expect(phaseCompleted.results.agentResults[0].status).toBe('failed')

    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'child-p1'`) as any[])[0]
    expect(row.status).toBe('failed')
  })

  it('marks the member failed (noting max_turns in the summary) while the DB row keeps the distinct max_turns terminal status (D6)', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const runner = {
      run: vi.fn(() => (async function* () {
        yield { type: 'turn_complete', turn: 1, tokensUsed: 5 }
        yield { type: 'done', response: { content: [{ type: 'text', text: 'partial progress' }] } }
        yield { type: 'max_turns_reached', turns: 1 }
      })()),
    }
    const registry = makeRegistry({ maxTurns: 1 })
    const conversations = makeConversations('child-mt')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    const result = await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(result.status).toBe('failed')
    expect(result.summary).toMatch(/max_turns/i)
    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'child-mt'`) as any[])[0]
    expect(row.status).toBe('max_turns')
  })

  // F2 T5 — a member that escalated is PARKED, not finished: the row stays
  // open for Task 6 to resume, and the phase result must show an unfinished
  // member (the re-planner treats 'failed' as not-done; T10 refines this).
  it('parks the member run on an escalation instead of completing it, and reports it as unfinished', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const runner = {
      run: vi.fn(() => (async function* () {
        yield { type: 'turn_complete', turn: 1, tokensUsed: 4 }
        yield { type: 'done', response: { content: [{ type: 'text', text: 'got as far as the escalation' }] } }
        yield { type: 'parked_for_approval', approvalId: 31, toolName: 'run_command' }
      })()),
    }
    const registry = makeRegistry()
    const conversations = makeConversations('child-park')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    const result = await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(result.status).toBe('failed')
    expect(result.summary).toContain('parked for approval #31')
    const row = (db.all(sql`SELECT status, completed_at FROM agent_sessions WHERE conversation_id = 'child-park'`) as any[])[0]
    expect(row.status).toBe('waiting_approval')
    expect(row.completed_at).toBeNull()
    // The child card follows the run — 'idle' would invite a board re-arm.
    expect(conversations.update).toHaveBeenCalledWith('child-park', { status: 'waiting_approval' })
  })

  // Fix round 1 / Important 4: the child card must follow the REAL park. When
  // park() refuses (row already finalized) or no supervisor is wired, the run
  // is finished — leaving its card 'waiting_approval' would wedge it unarmable
  // with nothing left to wake it.
  it('does NOT leave the child card waiting_approval when the park is refused', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const refusing = { beginRun: supervisor.beginRun, park: vi.fn(() => false) }
    const runner = {
      run: vi.fn(() => (async function* () {
        yield { type: 'done', response: { content: [{ type: 'text', text: 'partial' }] } }
        yield { type: 'parked_for_approval', approvalId: 44, toolName: 'run_command' }
      })()),
    }
    const conversations = makeConversations('child-refused')
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor: refusing as any,
    })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(refusing.park).toHaveBeenCalled()
    expect(conversations.update).toHaveBeenCalledWith('child-refused', { status: 'idle' })
    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE conversation_id = 'child-refused'`) as any[])[0]
    expect(row.status).toBe('completed')
  })

  it('wires the supervisor handle abort signal into the runner call so an operator cancel aborts the member', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    let capturedSignal: AbortSignal | undefined
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((r) => { releaseGate = r })
    const runner = {
      run: vi.fn((opts: any) => {
        capturedSignal = opts.signal
        return (async function* () {
          await gate
          if (opts.signal?.aborted) {
            yield { type: 'cancelled', reason: 'run aborted' }
            return
          }
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = makeRegistry()
    const conversations = makeConversations('child-cancel')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    const resultPromise = orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
    const row = (db.all(sql`SELECT id FROM agent_sessions WHERE conversation_id = 'child-cancel'`) as any[])[0]
    expect(supervisor.cancel(row.id)).toBe(true)
    expect(capturedSignal!.aborted).toBe(true)

    releaseGate()
    await resultPromise

    const finalRow = (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${row.id}`) as any[])[0]
    expect(finalRow.status).toBe('cancelled')
  })

  it('runs unsupervised (no agent_sessions row, no crash) when no supervisor dep is wired — back-compat', async () => {
    const runner = {
      run: vi.fn(() => (async function* () {
        yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
      })()),
    }
    const registry = makeRegistry()
    const conversations = makeConversations('child-nosup')
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: {} as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      // no supervisor
    })

    const result = await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)
    expect(result.status).toBe('completed')
  })

  // Fix round 1 / Important 2 — mergeWorktree used to run on the post-loop
  // path unconditionally, which a cancelled run now also reaches (handle
  // .complete() precedes it): an operator cancel could still land the
  // cancelled member's partial commits on the base branch.
  describe('cancelled member — worktree merge is skipped (Important 2 fix)', () => {
    let repo: string

    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'eyas-wt-cancel-'))
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
      execFileSync('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: repo })
    })

    afterEach(() => {
      rmSync(repo, { recursive: true, force: true })
    })

    it('does NOT merge the worktree branch back when the member run was cancelled', async () => {
      const db = createMemoryDb()
      ensureRunSupervisionSchema(db)
      const supervisor = createRunSupervisor({ db })
      let releaseGate: () => void = () => {}
      const gate = new Promise<void>((r) => { releaseGate = r })
      const runner = {
        run: vi.fn((opts: any) => {
          // Simulate the agent doing real work inside its isolated worktree
          // before the operator cancels the run.
          execFileSync('git', ['commit', '--allow-empty', '-m', 'sentinel-change', '-q'], { cwd: opts.toolContext.workingDirectory })
          return (async function* () {
            await gate
            if (opts.signal?.aborted) {
              yield { type: 'cancelled', reason: 'run aborted' }
              return
            }
            yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
          })()
        }),
      }
      const registry = makeRegistry()
      const conversations = makeConversations('child-wt-cancel')
      const orchestrator = createOrchestrator({
        agentRegistry: registry as any,
        agentRunner: runner as any,
        gateway: {} as any,
        conversations: conversations as any,
        toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
        toolExecutor: {} as any,
        supervisor,
      })

      const resultPromise = orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, {
        useWorktree: true,
        worktreeBasePath: repo,
      })

      const row = (db.all(sql`SELECT id FROM agent_sessions WHERE conversation_id = 'child-wt-cancel'`) as any[])[0]
      expect(supervisor.cancel(row.id)).toBe(true)
      releaseGate()
      const result = await resultPromise

      expect(result.status).toBe('failed')
      // A merge would fast-forward/merge the sentinel commit into the base
      // repo's checked-out branch — it must never have happened.
      const log = execFileSync('git', ['log', '--oneline', '-5'], { cwd: repo, encoding: 'utf-8' })
      expect(log).not.toContain('sentinel-change')
    })

    // Fix round 1 / Important 5: a parked member's worktree holds the edits the
    // resume (Task 6) continues from. Destroying it in the finally block made
    // the whole approval pointless — and retention only survives a restart if
    // the worktree is ALSO untracked, since the SIGTERM/exit handler
    // force-removes every tracked entry.
    it('RETAINS (and untracks) a parked member worktree instead of destroying its work', async () => {
      const db = createMemoryDb()
      ensureRunSupervisionSchema(db)
      const supervisor = createRunSupervisor({ db })
      let workingDirectory = ''
      const runner = {
        run: vi.fn((opts: any) => {
          workingDirectory = opts.toolContext.workingDirectory
          execFileSync('git', ['commit', '--allow-empty', '-m', 'sentinel-change', '-q'], { cwd: workingDirectory })
          return (async function* () {
            yield { type: 'done', response: { content: [{ type: 'text', text: 'partial' }] } }
            yield { type: 'parked_for_approval', approvalId: 21, toolName: 'run_command' }
          })()
        }),
      }
      const conversations = makeConversations('child-wt-park')
      const orchestrator = createOrchestrator({
        agentRegistry: makeRegistry() as any,
        agentRunner: runner as any,
        gateway: {} as any,
        conversations: conversations as any,
        toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
        toolExecutor: {} as any,
        supervisor,
      })

      const before = __getLiveWorktreeCountForTest()
      const result = await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, {
        useWorktree: true,
        worktreeBasePath: repo,
      })

      expect(result.status).toBe('failed') // unfinished member
      // The work is still on disk…
      expect(existsSync(workingDirectory)).toBe(true)
      // …and NOT merged into the base branch (it is mid-flight, not done).
      const log = execFileSync('git', ['log', '--oneline', '-5'], { cwd: repo, encoding: 'utf-8' })
      expect(log).not.toContain('sentinel-change')
      // Untracked, so a graceful shutdown cannot force-remove it.
      expect(__getLiveWorktreeCountForTest()).toBe(before)
      // And the boot GC leaves it alone: prune only clears records whose
      // directory is gone, and the agent/* sweep skips live worktrees.
      gcOrphanedWorktrees(repo)
      expect(existsSync(workingDirectory)).toBe(true)
      const branches = execFileSync('git', ['branch', '--list', 'agent/*'], { cwd: repo, encoding: 'utf-8' })
      expect(branches.trim()).not.toBe('')

      // F2 T6 (R6) — untracking removed the last in-process pointer, so the run
      // row has to carry one: without it the worktree leaks forever. Reclaiming
      // through that marker IS this test's cleanup, which is what proves the
      // marker is sufficient (path + branch + repo).
      const runId = (db.all(sql`SELECT id FROM agent_sessions WHERE conversation_id = 'child-wt-park'`) as any[])[0].id
      const marker = supervisor.takeRetainedWorktree(runId)
      expect(marker).toEqual({ path: workingDirectory, branch: expect.stringMatching(/^agent\//), basePath: repo })

      removeWorktree(marker!.basePath, { path: marker!.path, branch: marker!.branch })
      expect(existsSync(workingDirectory)).toBe(false)
      expect(execFileSync('git', ['branch', '--list', 'agent/*'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe('')
    })

    it('removes the worktree when the park was REFUSED — nothing will resume it', async () => {
      const db = createMemoryDb()
      ensureRunSupervisionSchema(db)
      const supervisor = createRunSupervisor({ db })
      const refusing = { beginRun: supervisor.beginRun, park: vi.fn(() => false) }
      let workingDirectory = ''
      const runner = {
        run: vi.fn((opts: any) => {
          workingDirectory = opts.toolContext.workingDirectory
          return (async function* () {
            yield { type: 'done', response: { content: [{ type: 'text', text: 'partial' }] } }
            yield { type: 'parked_for_approval', approvalId: 22, toolName: 'run_command' }
          })()
        }),
      }
      const orchestrator = createOrchestrator({
        agentRegistry: makeRegistry() as any,
        agentRunner: runner as any,
        gateway: {} as any,
        conversations: makeConversations('child-wt-refused') as any,
        toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
        toolExecutor: {} as any,
        supervisor: refusing as any,
      })

      await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, {
        useWorktree: true,
        worktreeBasePath: repo,
      })

      expect(existsSync(workingDirectory)).toBe(false)
    })

    it('still merges the worktree branch back on a normal (non-cancelled) completion', async () => {
      const db = createMemoryDb()
      ensureRunSupervisionSchema(db)
      const supervisor = createRunSupervisor({ db })
      const runner = {
        run: vi.fn((opts: any) => {
          execFileSync('git', ['commit', '--allow-empty', '-m', 'sentinel-change', '-q'], { cwd: opts.toolContext.workingDirectory })
          return (async function* () {
            yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
          })()
        }),
      }
      const registry = makeRegistry()
      const conversations = makeConversations('child-wt-ok')
      const orchestrator = createOrchestrator({
        agentRegistry: registry as any,
        agentRunner: runner as any,
        gateway: {} as any,
        conversations: conversations as any,
        toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
        toolExecutor: {} as any,
        supervisor,
      })

      const result = await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, {
        useWorktree: true,
        worktreeBasePath: repo,
      })

      expect(result.status).toBe('completed')
      const log = execFileSync('git', ['log', '--oneline', '-5'], { cwd: repo, encoding: 'utf-8' })
      expect(log).toContain('sentinel-change')
    })
  })
})
