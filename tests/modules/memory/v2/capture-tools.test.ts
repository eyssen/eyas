// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 1b (spec §16-4): tool results into L0, 8 KB cap, `ingested` trust,
// opt-in via memory.l0.captureToolResults.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, type ExecutionLogEntry } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import { captureToolResult } from '@modules/tools/l0-capture'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import { silentLogger, testIngestConfig } from './helpers'

function echoTool(): ToolImplementation {
  return {
    name: 'echo', description: 'Echo', category: 'custom', riskTier: 'green', inputSchema: {},
    execute: vi.fn(async (input: Record<string, unknown>) => ({ echoed: input })),
  }
}
function ctx(extra: Partial<ToolContext> = {}): ToolContext {
  return { conversationId: 'c1', userId: 'u1', agentId: 'a1', sessionId: 's1', logger: silentLogger, ...extra } as ToolContext
}
function entry(overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry {
  return { toolName: 'echo', input: { a: 1 }, output: { echoed: { a: 1 } }, success: true, durationMs: 3, timestamp: '2026-09-03T10:00:00.000Z', conversationId: 'c1', agentId: 'a1', sessionId: 's1', ...overrides }
}

let db: any
let enqueue: ReturnType<typeof vi.fn>

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id) VALUES ('c1', 'p1', 'u1')`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('tool executor log entry', () => {
  it('carries the session id from the tool context', async () => {
    const registry = createToolRegistry()
    registry.register(echoTool())
    const logExecution = vi.fn()
    const exec = createToolExecutor(registry, { authorization: 'disabled', logExecution })
    await exec.execute('echo', { a: 1 }, ctx())
    expect(logExecution).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'echo', success: true, conversationId: 'c1', agentId: 'a1', sessionId: 's1' }))
  })

  it('stamps sessionId on every logExecution call site (source contract)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/tools/tool-executor.ts'), 'utf-8')
    const sites = (source.match(/options\.logExecution\?\.\(\{/g) ?? []).length
    const stamped = (source.match(/sessionId: ctx\?\.sessionId,/g) ?? []).length
    expect(sites).toBeGreaterThanOrEqual(6)
    expect(stamped).toBe(sites)
  })
})

describe('tools/index.ts wiring (source contract)', () => {
  // The six behavioural tests below call captureToolResult directly with a
  // hand-made gate. Nothing else proves the real logExecution calls it, or
  // that the config path it reads is spelled correctly — delete that one line
  // or typo the property chain and every other test still passes.
  const source = readFileSync(resolve(process.cwd(), 'src/modules/tools/index.ts'), 'utf-8')
  it('calls captureToolResult from logExecution, gated on the config flag', () => {
    expect(source).toMatch(/captureToolResult\(ctx\.db, entry,/)
    expect(source).toMatch(/memory\?\.l0\?\.captureToolResults === true/)
  })
})

describe('captureToolResult', () => {
  it('captures nothing while memory.l0.captureToolResults is off', () => {
    captureToolResult(db, entry(), () => false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('captures a successful result as an ingested tool_result unit with provenance', () => {
    captureToolResult(db, entry(), () => true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'tool_result', actor: 'a1', conversationId: 'c1', projectId: 'p1',
      occurredAtMs: Date.parse('2026-09-03T10:00:00.000Z'), content: JSON.stringify({ echoed: { a: 1 } }), trustTier: 'ingested',
      meta: { origin: 'tool_executions', toolName: 'echo', sessionId: 's1', durationMs: 3, input: JSON.stringify({ a: 1 }) },
    })
  })

  it('skips failures, empty outputs and calls without a conversation', () => {
    captureToolResult(db, entry({ success: false, error: 'boom', output: undefined }), () => true)
    captureToolResult(db, entry({ output: {} }), () => true)
    captureToolResult(db, entry({ conversationId: undefined }), () => true)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('applies the 8 KB cap at flush and keeps the marker', () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)
    captureToolResult(db, entry({ output: { big: 'Z'.repeat(20_000) } }), () => true)
    ingest.flushConversation('c1', 'manual')
    const blob = (db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0]
    expect(blob.byte_length).toBeLessThan(8_192 + 80)
    const row = (db.all(sql`SELECT meta_json, trust_tier FROM memory_raw`) as any[])[0]
    expect(row.trust_tier).toBe('ingested')
    expect(JSON.parse(row.meta_json)).toMatchObject({ truncated: true, originalBytes: expect.any(Number) })
  })
})
