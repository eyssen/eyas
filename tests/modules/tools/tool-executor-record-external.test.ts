// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G12 — a tool a CLI runtime ran itself (Claude Code's Bash, Grok's file
// tools) reaches tool_executions through the executor's recordExternal: one
// row carrying its run, and nothing else — no execution, no hooks, no bus
// event, no L0 capture (the agent run's own observer owns that).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, type ExternalToolExecutionEntry } from '@modules/tools/tool-executor'
import { ensureToolExecutionsTable, recordToolExecution, toolNamesOfRuns } from '@modules/tools/execution-log'
import { setCapturePolicy } from '@modules/memory/v2/ingest-bridge'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import type { EyasDb } from '@core/types'

const { captureUnit } = vi.hoisted(() => ({ captureUnit: vi.fn() }))
vi.mock('@modules/memory/v2/ingest-bridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    captureUnit: (...args: unknown[]) => {
      captureUnit(...args)
      return (actual.captureUnit as (...a: unknown[]) => unknown)(...args)
    },
  }
})

function entry(over: Partial<ExternalToolExecutionEntry> = {}): ExternalToolExecutionEntry {
  return {
    toolName: 'run_command',
    input: { command: 'ls -la' },
    output: 'total 0',
    success: true,
    durationMs: 42,
    conversationId: 'conv-1',
    agentId: 'agent-1',
    runId: 'run-1',
    executedBy: 'provider',
    ...over,
  }
}

function rows(db: EyasDb): any[] {
  return db.all(sql`SELECT tool_name, conversation_id, agent_id, run_id, input, output, error, success, duration_ms
    FROM tool_executions ORDER BY id`) as any[]
}

const logger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }

describe('ToolExecutor.recordExternal (G12)', () => {
  let db: EyasDb
  let registry: ToolRegistry
  let emit: Mock
  let preHook: Mock

  beforeEach(() => {
    db = createMemoryDb()
    ensureToolExecutionsTable(db)
    registry = createToolRegistry()
    emit = vi.fn()
    preHook = vi.fn(async () => ({ decision: 'allow' as const }))
    captureUnit.mockClear()
  })

  function executor() {
    const ex = createToolExecutor(registry, {
      authorization: 'disabled',
      bus: { emit },
      logExecution: (e) => recordToolExecution(db, e),
    })
    ex.hooks.addPreToolUse(preHook as any)
    return ex
  }

  it('(+) writes one tool_executions row carrying the run, executing nothing', () => {
    const run = vi.fn()
    registry.register({
      name: 'run_command', description: 'x', category: 'custom', riskTier: 'red', inputSchema: {}, execute: run,
    } as unknown as ToolImplementation)
    const ex = executor()

    expect(ex.recordExternal(entry())).toBe(true)

    expect(rows(db)).toEqual([{
      tool_name: 'run_command',
      conversation_id: 'conv-1',
      agent_id: 'agent-1',
      run_id: 'run-1',
      input: JSON.stringify({ command: 'ls -la' }),
      output: JSON.stringify({ text: 'total 0' }),
      error: null,
      success: 1,
      duration_ms: 42,
    }])
    // The run's tool evidence now names the CLI-native call too.
    expect(toolNamesOfRuns(db, ['run-1'])).toEqual(['run_command'])
    expect(run).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(preHook).not.toHaveBeenCalled()
  })

  it('(+) a failed call keeps its error text and no output; a bad duration records 0', () => {
    const ex = executor()
    expect(ex.recordExternal(entry({ success: false, output: 'permission denied', durationMs: Number.NaN, runId: undefined }))).toBe(true)
    expect(rows(db)[0]).toMatchObject({ success: 0, output: null, error: 'permission denied', duration_ms: 0, run_id: null })
  })

  it('(−) performs no L0 write, whatever memory.l0.captureToolResults is set to', async () => {
    // The production wiring: the tools module's own executor and log writer.
    const { toolsModule } = await import('@modules/tools/index')
    const ctx: any = {
      db,
      bus: { emit, on: vi.fn() },
      logger,
      permissions: undefined,
      hasModule: () => false,
      config: { memory: { l0: { enabled: true, captureToolResults: true, captureThinking: true } } },
    }
    await toolsModule.onRegister!(ctx)
    for (const on of [true, false]) {
      setCapturePolicy(() => ({ toolResults: on, thinking: on }))
      expect(ctx.tools.executor.recordExternal(entry({ toolName: `read_file_${on}` }))).toBe(true)
    }
    setCapturePolicy(null)

    expect(rows(db).map((r) => r.tool_name)).toEqual(['read_file_true', 'read_file_false'])
    expect(captureUnit).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('(−) bridged EYAS tools (executedBy eyas) are not recorded twice', async () => {
    registry.register({
      name: 'memory_search', description: 'x', category: 'custom', riskTier: 'green', inputSchema: {},
      execute: async () => ({ results: [] }),
    } as unknown as ToolImplementation)
    const ex = executor()
    const ctx: ToolContext = { conversationId: 'conv-1', agentId: 'agent-1', runId: 'run-1', logger } as ToolContext

    // The bridge ran it through the executor (one row); the provider then
    // reports the same call as settled by EYAS.
    await ex.execute('memory_search', { query: 'q' }, ctx)
    expect(ex.recordExternal(entry({ toolName: 'memory_search', executedBy: 'eyas' }))).toBe(false)
    // An unknown executor (an ACP kind EYAS cannot classify) is left out too.
    expect(ex.recordExternal(entry({ toolName: 'memory_search', executedBy: undefined }))).toBe(false)

    expect(rows(db).map((r) => r.tool_name)).toEqual(['memory_search'])
  })

  it('(−) nothing is written without a log writer, a tool name, or when the write throws', () => {
    const bare = createToolExecutor(registry, { authorization: 'disabled' })
    expect(bare.recordExternal(entry())).toBe(false)

    const ex = executor()
    expect(ex.recordExternal(entry({ toolName: '' }))).toBe(false)

    const throwing = createToolExecutor(registry, {
      authorization: 'disabled',
      logExecution: () => { throw new Error('db locked') },
    })
    expect(throwing.recordExternal(entry())).toBe(false)
    expect(rows(db)).toEqual([])
  })
})
