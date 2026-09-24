// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One capture of a run's tool I/O and reasoning, for every provider: the
// runner's own executor (API providers), a CLI's bridged EYAS tool and a
// CLI's built-in tool all leave the same 'tool_result' unit, stamped with the
// pair that answered the model call that asked for it. Both switches are
// opt-in (memory.l0.captureToolResults / captureThinking). A unit's content is
// what the call returned; its arguments ride on the row's meta (provenance only).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { createRunCapture, RUN_CAPTURE_INPUT_MAX_CHARS, type RunCaptureOptions } from '@modules/memory/v2/run-capture'
import {
  attachIngest,
  capturePolicy,
  resetIngestBridge,
  setCapturePolicy,
  type CapturePolicy,
} from '@modules/memory/v2/ingest-bridge'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { initZstd } from '@shared/zstd'
import { retrieve } from '@modules/memory/v2/retrieve'
import { expandMemoryId } from '@modules/memory/v2/expand'
import { assembleRecall } from '@modules/memory/v2/assemble'
import { runExtraction } from '@modules/memory/v2/extractor'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { makeUnit, silentLogger, testIngestConfig } from './helpers'

const ON: CapturePolicy = { toolResults: true, thinking: true }
const OFF: CapturePolicy = { toolResults: false, thinking: false }

let db: any
let enqueue: ReturnType<typeof vi.fn>

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id, agent_id) VALUES ('c1', 'p1', 'u1', 'agent-1')`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

function capture(over: Partial<RunCaptureOptions> = {}) {
  return createRunCapture({
    db, conversationId: 'c1', sessionId: 's1', entryPath: 'background', provider: 'req-p', model: 'req-m',
    policy: () => ON, now: () => 1_700_000_000_000, ...over,
  })
}
const units = () => enqueue.mock.calls.map((c) => c[0])
const toolUnits = () => units().filter((u) => u.sourceType === 'tool_result')
const contentOf = (u: any) => JSON.parse(u.content)

const start = (id: string, name: string, input: Record<string, unknown> = {}, rawName?: string): AgentEvent =>
  ({ type: 'tool_use_start', id, name, input, ...(rawName ? { rawName } : {}) })
const result = (toolUseId: string, content: string, extra: Partial<Extract<AgentEvent, { type: 'tool_result' }>> = {}): AgentEvent =>
  ({ type: 'tool_result', toolUseId, content, isError: false, durationMs: 4, outcome: 'success', executedBy: 'eyas', ...extra })
const turnDone = (turn: number, provider: string, model: string): AgentEvent =>
  ({ type: 'turn_complete', turn, tokensUsed: 2, provider, model })

describe('createRunCapture — tool results', () => {
  it('captures an EYAS-executed, a CLI-native and a bridged tool once each, with the answering pair and the entry path', () => {
    const cap = capture()
    // A CLI turn: its own Bash and a bridged EYAS tool run inside the call.
    cap.observe(start('n1', 'Bash', { command: 'ls' }))
    cap.observe(result('n1', 'a.txt\nb.txt', { executedBy: 'provider' }))
    cap.observe(start('b1', 'memory_search', { query: 'invoice' }, 'mcp__eyas__memory_search'))
    cap.observe(result('b1', '{"hits":[]}', { executedBy: 'eyas' }))
    // Nothing leaves before the call that ran them completes (its pair is unknown).
    expect(enqueue).not.toHaveBeenCalled()
    cap.observe(turnDone(1, 'claude-code', 'opus'))
    // An API turn: the runner executes the tool after the call completes.
    cap.observe(start('e1', 'read_file', { path: '/x' }))
    cap.observe(turnDone(2, 'openai', 'gpt-x'))
    cap.observe(start('e1', 'read_file', { path: '/x' }))
    cap.observe(result('e1', '{"content":"hello"}', { executedBy: 'eyas' }))
    cap.end()

    const got = toolUnits()
    expect(got).toHaveLength(3)
    const byId = Object.fromEntries(got.map((u) => [u.meta.toolUseId, u]))
    expect(byId.n1).toMatchObject({
      actor: 'tool:run_command', trustTier: 'ingested', conversationId: 'c1', projectId: 'p1',
      meta: { origin: 'agent_run', provider: 'claude-code', model: 'opus', entryPath: 'background', sessionId: 's1', agentId: 'agent-1', rawName: 'Bash', turn: 1, input: { command: 'ls' } },
    })
    // The content is what the call returned; the arguments are provenance (meta.input).
    expect(contentOf(byId.n1)).toEqual({ tool: 'run_command', output: 'a.txt\nb.txt', isError: false, outcome: 'success', executedBy: 'provider' })
    expect(byId.b1.meta).toMatchObject({ provider: 'claude-code', model: 'opus', rawName: 'mcp__eyas__memory_search', input: { query: 'invoice' } })
    expect(contentOf(byId.b1)).toEqual({ tool: 'memory_search', output: '{"hits":[]}', isError: false, outcome: 'success', executedBy: 'eyas' })
    // Stamped with the pair of the call that ASKED for it, not the next one.
    expect(byId.e1.meta).toMatchObject({ provider: 'openai', model: 'gpt-x', turn: 2, entryPath: 'background', input: { path: '/x' } })
    expect(contentOf(byId.e1)).toEqual({ tool: 'read_file', output: '{"content":"hello"}', isError: false, outcome: 'success', executedBy: 'eyas' })
    for (const u of got) {
      expect(contentOf(u)).not.toHaveProperty('input')
      expect(u.content).not.toContain('invoice')
    }
  })

  it('captures a failed call too (it ran), marked as an error', () => {
    const cap = capture()
    cap.observe(start('t1', 'run_command', { command: 'false' }))
    cap.observe(turnDone(1, 'p', 'm'))
    cap.observe(result('t1', 'Error: exit 1', { isError: true, outcome: 'error' }))
    cap.end()
    expect(toolUnits()).toHaveLength(1)
    expect(contentOf(toolUnits()[0])).toMatchObject({ isError: true, outcome: 'error' })
  })

  it('clips a long input in the meta and keeps the call; the content never holds it', () => {
    const cap = capture()
    cap.observe(start('t1', 'write_file', { path: '/a', content: 'Z'.repeat(5_000) }))
    cap.observe(turnDone(1, 'p', 'm'))
    cap.observe(result('t1', '{"ok":true}'))
    cap.end()
    const [unit] = toolUnits()
    const input = unit.meta.input
    expect(typeof input).toBe('string')
    expect(input.length).toBe(RUN_CAPTURE_INPUT_MAX_CHARS + 1)
    expect(input.endsWith('…')).toBe(true)
    expect(contentOf(unit)).toEqual({ tool: 'write_file', output: '{"ok":true}', isError: false, outcome: 'success', executedBy: 'eyas' })
    expect(unit.content).not.toContain('ZZZ')
  })

  it('keeps a plain-JSON snapshot of the arguments as they were when the call settled', () => {
    const nested = { mode: 'before' }
    const cap = capture()
    cap.observe(start('t1', 'run_command', { command: 'make', opts: nested }))
    cap.observe(result('t1', 'built', { executedBy: 'provider' }))
    // Mutated while the unit waits for its call to complete: the row keeps what ran.
    nested.mode = 'after'
    cap.observe(turnDone(1, 'p', 'm'))
    cap.observe(start('t2', 'run_command', { command: 'make', size: 10n as unknown }))
    cap.observe(result('t2', 'built again', { executedBy: 'provider' }))
    cap.end()
    const [first, second] = toolUnits()
    expect(first.meta.input).toEqual({ command: 'make', opts: { mode: 'before' } })
    // (−) arguments that cannot be serialised are not kept, and do not cost the unit.
    expect(second.meta.input).toBe('[unserialisable]')
    expect(contentOf(second)).toMatchObject({ output: 'built again' })
    expect(() => JSON.stringify(second.meta)).not.toThrow()
  })

  it('a result whose call never completed is stamped at the end with the last answering pair, else the requested one', () => {
    const cap = capture()
    cap.observe(start('t1', 'run_command', { command: 'ls' }))
    cap.observe(result('t1', 'a.txt', { executedBy: 'provider' }))
    cap.end()
    expect(toolUnits()[0].meta).toMatchObject({ provider: 'req-p', model: 'req-m' })

    enqueue.mockClear()
    const cap2 = capture()
    cap2.observe(turnDone(1, 'grok-cli', 'grok-4'))
    cap2.observe(start('t2', 'run_command', { command: 'ls' }))
    cap2.observe(result('t2', 'b.txt', { executedBy: 'provider' }))
    cap2.end()
    expect(toolUnits()[0].meta).toMatchObject({ provider: 'grok-cli', model: 'grok-4' })
  })

  it('a result without a matching start still gets a unit, as tool "unknown"', () => {
    const cap = capture()
    cap.observe(result('orphan', 'something'))
    cap.end()
    expect(toolUnits()).toHaveLength(1)
    expect(toolUnits()[0].actor).toBe('tool:unknown')
    expect(contentOf(toolUnits()[0])).toEqual({ tool: 'unknown', output: 'something', isError: false, outcome: 'success', executedBy: 'eyas' })
    // No start, no known arguments: none are invented.
    expect(toolUnits()[0].meta).not.toHaveProperty('input')
  })

  it('captures nothing while the tool-result switch is off', () => {
    const cap = capture({ policy: () => OFF })
    cap.observe(start('t1', 'run_command'))
    cap.observe(result('t1', 'output', { executedBy: 'provider' }))
    cap.observe({ type: 'thinking', text: 'reasoning' })
    cap.observe(turnDone(1, 'p', 'm'))
    cap.end()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('the default policy (nothing installed) is off', () => {
    expect(capturePolicy()).toEqual(OFF)
    const cap = createRunCapture({ db, conversationId: 'c1' })
    cap.observe(start('t1', 'run_command'))
    cap.observe(result('t1', 'output'))
    cap.observe(turnDone(1, 'p', 'm'))
    cap.end()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does not capture a denied, skipped or approval-waiting call', () => {
    const cap = capture()
    for (const [id, outcome] of [['d', 'denied'], ['s', 'skipped'], ['a', 'approval_required']] as const) {
      cap.observe(start(id, 'run_command'))
      cap.observe(result(id, `Refused: ${id}`, { isError: true, outcome }))
    }
    cap.observe(turnDone(1, 'p', 'm'))
    cap.end()
    expect(toolUnits()).toHaveLength(0)
  })

  it('does not capture an empty result', () => {
    const cap = capture()
    for (const [id, content] of [['e1', ''], ['e2', '{}'], ['e3', 'null'], ['e4', '   ']]) {
      cap.observe(start(id, 'noop'))
      cap.observe(result(id, content))
    }
    cap.observe(turnDone(1, 'p', 'm'))
    cap.end()
    expect(toolUnits()).toHaveLength(0)
  })

  it('captures a repeated tool_result for the same call once', () => {
    const cap = capture()
    cap.observe(start('t1', 'run_command'))
    cap.observe(result('t1', 'first', { executedBy: 'provider' }))
    cap.observe(result('t1', 'second', { executedBy: 'provider' }))
    cap.observe(turnDone(1, 'p', 'm'))
    cap.observe(result('t1', 'third'))
    cap.end()
    expect(toolUnits()).toHaveLength(1)
    expect(contentOf(toolUnits()[0]).output).toBe('first')
  })

  it('never throws into the run, and captures nothing after end()', () => {
    const cap = capture({ policy: () => { throw new Error('config gone') } })
    expect(() => { cap.observe(start('t1', 'x')); cap.observe(result('t1', 'y')); cap.end() }).not.toThrow()
    const cap2 = capture()
    cap2.end()
    cap2.observe(start('t2', 'x'))
    cap2.observe(result('t2', 'y'))
    cap2.end()
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('createRunCapture — thinking', () => {
  it('turns the reasoning of each model call into one derived thinking unit with that call\'s pair', () => {
    const cap = capture()
    cap.observe({ type: 'thinking', text: 'First I ' })
    cap.observe({ type: 'thinking', text: 'check the file.' })
    cap.observe(turnDone(1, 'anthropic', 'sonnet'))
    cap.observe({ type: 'thinking', text: 'Now answer.' })
    cap.observe(turnDone(2, 'anthropic', 'opus'))
    cap.end()
    const thinking = units().filter((u) => u.sourceType === 'thinking')
    expect(thinking).toHaveLength(2)
    expect(thinking[0]).toMatchObject({
      content: 'First I check the file.', trustTier: 'derived', actor: 'agent-1',
      meta: { origin: 'agent_run', provider: 'anthropic', model: 'sonnet', entryPath: 'background', turn: 1 },
    })
    expect(thinking[1]).toMatchObject({ content: 'Now answer.', meta: { model: 'opus', turn: 2 } })
  })

  it('keeps reasoning out while only tool results are on, and tool results out while only thinking is on', () => {
    const toolsOnly = capture({ policy: () => ({ toolResults: true, thinking: false }) })
    toolsOnly.observe({ type: 'thinking', text: 'hidden' })
    toolsOnly.observe(start('t1', 'run_command'))
    toolsOnly.observe(result('t1', 'out'))
    toolsOnly.observe(turnDone(1, 'p', 'm'))
    toolsOnly.end()
    expect(units().map((u) => u.sourceType)).toEqual(['tool_result'])

    enqueue.mockClear()
    const thinkingOnly = capture({ policy: () => ({ toolResults: false, thinking: true }) })
    thinkingOnly.observe({ type: 'thinking', text: 'kept' })
    thinkingOnly.observe(start('t1', 'run_command'))
    thinkingOnly.observe(result('t1', 'out'))
    thinkingOnly.observe(turnDone(1, 'p', 'm'))
    thinkingOnly.end()
    expect(units().map((u) => u.sourceType)).toEqual(['thinking'])
  })

  it('flushes the reasoning of an unfinished call at the end, and skips blank reasoning', () => {
    const cap = capture()
    cap.observe({ type: 'thinking', text: '   ' })
    cap.observe(turnDone(1, 'p', 'm'))
    cap.observe({ type: 'thinking', text: 'cut off' })
    cap.end()
    const thinking = units().filter((u) => u.sourceType === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0]).toMatchObject({ content: 'cut off', meta: { provider: 'p', model: 'm', turn: 2 } })
  })
})

describe('capturePolicy — the switches', () => {
  it('reads the installed getter per call; anything but true is off', () => {
    let current: any = { toolResults: true, thinking: 'yes' }
    setCapturePolicy(() => current)
    expect(capturePolicy()).toEqual({ toolResults: true, thinking: false })
    current = { thinking: true }
    expect(capturePolicy()).toEqual({ toolResults: false, thinking: true })
  })

  it('a throwing getter, a cleared getter and a reset all mean off', () => {
    setCapturePolicy(() => { throw new Error('boom') })
    expect(capturePolicy()).toEqual(OFF)
    setCapturePolicy(() => ON)
    setCapturePolicy(null)
    expect(capturePolicy()).toEqual(OFF)
    setCapturePolicy(() => ON)
    resetIngestBridge()
    expect(capturePolicy()).toEqual(OFF)
  })
})

// ─── Through the real runner ──────────────────────────────────────────────

function response(provider: string, model: string, content: ModelResponse['content'], stopReason: ModelResponse['stopReason'] = 'end'): ModelResponse {
  return { id: 'r', provider, model, content, stopReason, usage: { inputTokens: 1, outputTokens: 1 } }
}

function scripted(calls: StreamEvent[][]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    async complete() { throw new Error('streaming only') },
    async *stream() { for (const e of calls[i++] ?? []) yield e },
  } as unknown as ModelGateway
}

async function drain(gen: AsyncGenerator<unknown>) { for await (const _ of gen) { /* consume */ } }

function runnerWith(gateway: ModelGateway, policy: CapturePolicy = ON, extra: Record<string, unknown> = {}) {
  const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { rows: 3 }, durationMs: 2 })) }
  const startRunCapture = vi.fn((run: any) => createRunCapture({ db, ...run, policy: () => policy }))
  const runner = createAgentRunner({ gateway, toolExecutor, startRunCapture, ...extra } as any)
  return { runner, toolExecutor, startRunCapture }
}

describe('agent runner → run capture', () => {
  it('a CLI run leaves its native and bridged tools and its reasoning, with the effective pair and entry path', async () => {
    const gateway = scripted([[
      { type: 'thinking', text: 'Look first.' },
      { type: 'tool_use_start', id: 'n1', name: 'run_command', rawName: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', toolUseId: 'n1', content: 'a.txt', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'tool_use_start', id: 'b1', name: 'memory_search', rawName: 'mcp__eyas__memory_search', input: { query: 'q' } },
      { type: 'tool_result', toolUseId: 'b1', content: '{"hits":[]}', isError: false, durationMs: 3, outcome: 'success', executedBy: 'eyas' },
      { type: 'tool_use_start', id: 'x1', name: 'run_command', rawName: 'Bash', input: { command: 'rm -rf /' } },
      { type: 'tool_result', toolUseId: 'x1', content: 'denied by gate', isError: true, durationMs: 0, outcome: 'denied', executedBy: 'provider' },
      { type: 'text', text: 'Done.' },
      { type: 'done', response: response('claude-code', 'opus-effective', [{ type: 'text', text: 'Done.' }]) },
    ]])
    const { runner, startRunCapture } = runnerWith(gateway)
    await drain(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 3,
      provider: 'claude-code', model: 'opus-requested', sessionId: 'sess-1',
      toolContext: { conversationId: 'c1', agentId: 'agent-1' } as any,
      metadata: { conversationId: 'c1', origin: 'scheduled' },
    } as any))

    expect(startRunCapture).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1', agentId: 'agent-1', sessionId: 'sess-1', entryPath: 'background', provider: 'claude-code', model: 'opus-requested',
    }))
    const tools = toolUnits()
    expect(tools.map((u) => u.meta.toolUseId).sort()).toEqual(['b1', 'n1'])
    for (const u of tools) {
      expect(u.meta).toMatchObject({ origin: 'agent_run', provider: 'claude-code', model: 'opus-effective', entryPath: 'background', sessionId: 'sess-1' })
    }
    const thinking = units().filter((u) => u.sourceType === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0]).toMatchObject({ content: 'Look first.', meta: { model: 'opus-effective' } })
  })

  it('an API run leaves the tool the runner executed, stamped with the call that asked for it', async () => {
    const gateway = scripted([
      [
        { type: 'tool_use_start', id: 'e1', name: 'search_memory', input: {} },
        { type: 'done', response: response('openai', 'gpt-a', [{ type: 'tool_use', id: 'e1', name: 'search_memory', input: { q: 'x' } }], 'tool_use') },
      ],
      [{ type: 'done', response: response('anthropic', 'fallback-b', [{ type: 'text', text: 'final' }]) }],
    ])
    const { runner, toolExecutor } = runnerWith(gateway)
    await drain(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'search_memory', description: 'x', inputSchema: { type: 'object' } }],
      maxTurns: 3, conversationId: 'c1', entryPath: 'a2a', metadata: { origin: 'delegation' },
    } as any))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    const tools = toolUnits()
    expect(tools).toHaveLength(1)
    expect(tools[0].meta).toMatchObject({ provider: 'openai', model: 'gpt-a', entryPath: 'a2a', turn: 1, input: { q: 'x' } })
    expect(contentOf(tools[0])).toEqual({ tool: 'search_memory', output: '{"rows":3}', isError: false, outcome: 'success', executedBy: 'eyas' })
  })

  it('captures nothing with the switches off, and nothing for a run without a conversation', async () => {
    const cli = (): StreamEvent[] => [
      { type: 'thinking', text: 'hmm' },
      { type: 'tool_use_start', id: 'n1', name: 'run_command', input: { command: 'ls' } },
      { type: 'tool_result', toolUseId: 'n1', content: 'a.txt', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'done', response: response('grok-cli', 'grok', [{ type: 'text', text: 'ok' }]) },
    ]
    const off = runnerWith(scripted([cli()]), OFF)
    await drain(off.runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1' } as any))
    expect(enqueue).not.toHaveBeenCalled()

    const noConv = runnerWith(scripted([cli()]))
    await drain(noConv.runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2 } as any))
    expect(noConv.startRunCapture).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a capture that cannot start never breaks the run', async () => {
    const gateway = scripted([[{ type: 'done', response: response('p', 'm', [{ type: 'text', text: 'ok' }]) }]])
    const runner = createAgentRunner({
      gateway, toolExecutor: { execute: vi.fn() }, startRunCapture: () => { throw new Error('no db') },
    } as any)
    const events: any[] = []
    for await (const e of runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1' } as any)) events.push(e)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('ends the capture when the run throws, keeping what the provider already ran', async () => {
    let i = 0
    const gateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
      async complete() { throw new Error('x') },
      async *stream() {
        i++
        yield { type: 'tool_use_start', id: 'n1', name: 'run_command', input: { command: 'make' } } as StreamEvent
        yield { type: 'tool_result', toolUseId: 'n1', content: 'built', isError: false, durationMs: 9, outcome: 'success', executedBy: 'provider' } as StreamEvent
        throw new Error('network drop')
      },
    } as unknown as ModelGateway
    const { runner } = runnerWith(gateway)
    await expect(drain(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1', provider: 'kimi-cli', model: 'k2',
    } as any))).rejects.toThrow('network drop')
    expect(i).toBe(1)
    expect(toolUnits()).toHaveLength(1)
    expect(toolUnits()[0].meta).toMatchObject({ provider: 'kimi-cli', model: 'k2' })
  })

  it('lands in memory_raw as an ingested tool_result row with the provenance meta', async () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)
    const gateway = scripted([[
      { type: 'tool_use_start', id: 'n1', name: 'run_command', input: { command: 'cat big' } },
      { type: 'tool_result', toolUseId: 'n1', content: 'Z'.repeat(20_000), isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'done', response: response('claude-code', 'opus', [{ type: 'text', text: 'ok' }]) },
    ]])
    const { runner } = runnerWith(gateway)
    await drain(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1', metadata: { origin: 'interactive' } } as any))
    ingest.flushConversation('c1', 'manual')
    const rows = db.all(sql`SELECT rid, source_type, actor, trust_tier, project_id, meta_json FROM memory_raw WHERE conversation_id = 'c1'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_type: 'tool_result', actor: 'tool:run_command', trust_tier: 'ingested', project_id: 'p1' })
    // The whole raw record: the arguments are on the row, the output byte-capped in the content.
    expect(JSON.parse(rows[0].meta_json)).toMatchObject({
      origin: 'agent_run', provider: 'claude-code', model: 'opus', entryPath: 'interactive', truncated: true,
      toolName: 'run_command', input: { command: 'cat big' },
    })
    if (caps.fts5) {
      const hit = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q}`) as any[]).map((r) => r.rowid)
      expect(hit('run_command')).toEqual([rows[0].rid])
      // (−) the argument text is not indexed
      expect(hit('big')).toEqual([])
    }
    const blob = (db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0]
    expect(blob.byte_length).toBeLessThan(8_192 + 80)
  })
})

describe('captured tool I/O never comes back as memory', () => {
  it('(−) a captured call\'s arguments and output never reach another conversation\'s recall; (+) a message does', async () => {
    resetIngestBridge()
    db.run(sql`INSERT INTO conversations (id, project_id, user_id, agent_id) VALUES ('c2', 'p1', 'u1', 'agent-1')`)
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)
    // A CLI's own tool (credentials in its arguments) and a bridged read (a secret in its output).
    const gateway = scripted([[
      { type: 'tool_use_start', id: 'n1', name: 'browser_fill', input: { selector: '#harbor-ledger-password', value: 'PASSWORD-ARG-8181', note: 'harbor ledger reconciliation invoice' } },
      { type: 'tool_result', toolUseId: 'n1', content: 'filled harbor ledger reconciliation form for the harbor invoice', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'tool_use_start', id: 'b1', name: 'read_file', input: { path: '/srv/harbor/.env' } },
      { type: 'tool_result', toolUseId: 'b1', content: 'HARBOR_LEDGER_TOKEN=TOKEN-OUT-9292 # harbor invoice reconciliation', isError: false, durationMs: 3, outcome: 'success', executedBy: 'eyas' },
      { type: 'done', response: response('claude-code', 'opus', [{ type: 'text', text: 'ok' }]) },
    ]])
    const { runner } = runnerWith(gateway)
    await drain(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1', metadata: { origin: 'interactive' } } as any))
    ingest.enqueue(makeUnit({ id: 'u-own', conversationId: 'c1', projectId: 'p1', sourceType: 'user_message', trustTier: 'owner', content: 'Harbor ledger reconciliation closes every harbor invoice.' }))
    ingest.flushConversation('c1', 'manual')
    const toolIds = (db.all(sql`SELECT id FROM memory_raw WHERE source_type = 'tool_result'`) as Array<{ id: string }>).map((r) => r.id)
    expect(toolIds).toHaveLength(2)

    const query = 'harbor ledger reconciliation invoice'
    const hits = await retrieve({ db, logger: silentLogger }, { query, projectId: 'p1', projectTypeId: null, excludeConversationId: 'c2', language: 'en' })
    expect(hits.map((h) => h.id)).toContain('rw:u-own')
    for (const id of toolIds) {
      expect(hits.map((h) => h.id)).not.toContain(`rw:${id}`)
      expect(expandMemoryId(db, `rw:${id}`, { projectId: 'p1' })).toBeNull()
    }
    const out = (await assembleRecall({ db, logger: silentLogger }, {
      conversationId: 'c2',
      scope: { projectId: 'p1', projectTypeId: null },
      query,
      budgetChars: 40_000,
      profile: { providerId: 'api', modelId: 'm-1', toolAddressing: { kind: 'native' }, drillDown: true },
    }))!
    expect(out.content).toContain('Harbor ledger reconciliation closes every harbor invoice.')
    for (const leaked of ['PASSWORD-ARG-8181', 'TOKEN-OUT-9292', '/srv/harbor/.env', 'harbor-ledger-password']) {
      expect(out.content).not.toContain(leaked)
    }
  })
})

describe('a captured call\'s arguments never feed extraction', () => {
  const extract = () => runExtraction(db, 'c1', 'close', { logger: silentLogger, config: () => ({ engine: 'v2', extractInLegacy: true }) })

  it('(−) an argument string never becomes a topic, an entity, a fact or an IDF stem; (+) the output still does', async () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)
    // Every argument is shaped to be picked up if it were extracted: a code
    // identifier, a capitalised phrase, a mention, a ticket, a file name and a
    // `key: value` line.
    const args = {
      query: 'zephyr_arg_marker',
      note: 'Please file it under Quokka Vault Ledger for @argowner and #48213.',
      path: '/srv/argdir/wombat_arg_notes.yaml',
      body: 'owner: Quokka Arg Person',
    }
    const gateway = scripted([[
      { type: 'tool_use_start', id: 'n1', name: 'run_command', rawName: 'Bash', input: args },
      { type: 'tool_result', toolUseId: 'n1', content: 'loaded the kestrel_output_marker table', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'done', response: response('claude-code', 'opus', [{ type: 'text', text: 'Loaded.' }]) },
    ]])
    const { runner } = runnerWith(gateway)
    await drain(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, conversationId: 'c1', metadata: { origin: 'interactive' } } as any))
    ingest.enqueue(makeUnit({ id: 'u-own', conversationId: 'c1', projectId: 'p1', sourceType: 'user_message', trustTier: 'owner', content: 'Please reconcile the harbor ledger before Friday.' }))
    ingest.flushConversation('c1', 'manual')

    // The arguments are still on the raw row, verbatim.
    const raw = (db.all(sql`SELECT meta_json FROM memory_raw WHERE source_type = 'tool_result'`) as any[])
    expect(raw).toHaveLength(1)
    expect(JSON.parse(raw[0].meta_json).input).toEqual(args)

    expect(extract().status).toBe('ok')
    const topics = (db.all(sql`SELECT tag_value FROM memory_tag WHERE memory_type = 'gist' AND tag_type IN ('topic', 'entity')`) as any[]).map((r) => String(r.tag_value).toLowerCase())
    const entities = (db.all(sql`SELECT canonical_name, aliases_json FROM memory_entity`) as any[]).map((r) => `${r.canonical_name} ${r.aliases_json}`.toLowerCase())
    const facts = (db.all(sql`SELECT subject, predicate, object_text FROM memory_fact`) as any[]).map((r) => `${r.subject} ${r.predicate} ${r.object_text}`.toLowerCase())
    const gists = (db.all(sql`SELECT text, structured_json FROM memory_gist`) as any[]).map((r) => `${r.text} ${r.structured_json}`.toLowerCase())
    const stems = (db.all(sql`SELECT stem FROM memory_idf`) as any[]).map((r) => String(r.stem))

    // (+) the output and the message are extracted as before
    expect(entities.some((e) => e.includes('kestrel_output_marker'))).toBe(true)
    expect(topics).toContain('kestrel_output_marker')
    expect(stems).toContain('kestr')
    expect(stems).toContain('harbo')
    // (−) not one argument reaches a derived layer
    const derived = [...topics, ...entities, ...facts, ...gists]
    for (const leaked of ['zephyr', 'quokka', 'argowner', '48213', 'wombat', 'argdir', 'arg person']) {
      expect(derived.filter((d) => d.includes(leaked))).toEqual([])
    }
    for (const stem of ['zephy', 'quokk', 'argow', 'womba', 'argdi']) expect(stems).not.toContain(stem)
  })
})

describe('wiring (source contract)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8')

  it('the memory module installs the two switches from memory.l0, read per call', () => {
    const source = read('src/modules/memory/index.ts')
    expect(source).toMatch(/setCapturePolicy\(\(\) => \{/)
    expect(source).toMatch(/toolResults: c\.captureToolResults === true, thinking: c\.captureThinking === true/)
  })

  it('the agent module gives every runner run a capture', () => {
    expect(read('src/modules/agent/index.ts')).toMatch(/startRunCapture: \(run\) => createRunCapture\(\{ db: ctx\.db, \.\.\.run \}\)/)
  })

  it('the tool executor log no longer captures into memory', () => {
    const source = read('src/modules/tools/index.ts')
    expect(source).not.toMatch(/l0-capture/)
    expect(source).not.toMatch(/captureToolResult/)
  })
})
