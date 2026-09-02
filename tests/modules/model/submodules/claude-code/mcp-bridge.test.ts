// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolImplementation, ToolContext, ToolCategory } from '@modules/tools/types.js'
import type { ExecutionResult } from '@modules/tools/tool-executor.js'

// ── SDK mocks ──────────────────────────────────────────────────────────

const mockTool = vi.fn((_name: string, _desc: string, _shape: unknown, handler: Function) => ({
  _name,
  _handler: handler,
}))

const mockCreateSdkMcpServer = vi.fn((opts: { name: string; version: string; tools: unknown[] }) => ({
  _serverName: opts.name,
  _serverVersion: opts.version,
  _tools: opts.tools,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockTool,
}))

// ── Helpers ────────────────────────────────────────────────────────────

function makeTool(overrides: Partial<ToolImplementation> = {}): ToolImplementation {
  return {
    name: overrides.name ?? 'test_tool',
    description: overrides.description ?? 'A test tool',
    category: overrides.category ?? 'memory',
    riskTier: overrides.riskTier ?? 'green',
    inputSchema: overrides.inputSchema ?? {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
    execute: overrides.execute ?? vi.fn(),
  }
}

function makeExecutor(result?: Partial<ExecutionResult>) {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: { data: 'ok' },
      durationMs: 42,
      ...result,
    }),
  }
}

const baseCtx: ToolContext = {
  conversationId: 'conv-1',
  userId: 'user-1',
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('MCP Bridge', () => {
  let buildMcpBridge: typeof import('@modules/model/submodules/claude-code/mcp-bridge.js').buildMcpBridge

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('@modules/model/submodules/claude-code/mcp-bridge.js')
    buildMcpBridge = mod.buildMcpBridge
  })

  // 1. Filters excluded categories
  it('filters out shell and browser tools', () => {
    const tools: ToolImplementation[] = [
      makeTool({ name: 'mem_search', category: 'memory' }),
      makeTool({ name: 'run_cmd', category: 'shell' }),
      makeTool({ name: 'open_page', category: 'browser' }),
      makeTool({ name: 'find_docs', category: 'search' }),
    ]

    buildMcpBridge(tools, makeExecutor(), baseCtx)

    // tool() should have been called only for non-excluded tools
    const convertedNames = mockTool.mock.calls.map(c => c[0])
    expect(convertedNames).toContain('mem_search')
    expect(convertedNames).toContain('find_docs')
    expect(convertedNames).not.toContain('run_cmd')
    expect(convertedNames).not.toContain('open_page')
    expect(mockTool).toHaveBeenCalledTimes(2)
  })

  // 2. Converts tool properties to Zod shape
  it('converts inputSchema properties to z.unknown() shape keys', () => {
    const tools = [
      makeTool({
        name: 'multi_prop',
        inputSchema: {
          type: 'object',
          properties: {
            alpha: { type: 'string' },
            beta: { type: 'number' },
            gamma: { type: 'boolean' },
          },
        },
      }),
    ]

    buildMcpBridge(tools, makeExecutor(), baseCtx)

    const shape = mockTool.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(shape)).toEqual(['alpha', 'beta', 'gamma'])
  })

  // 3. Handler success path
  it('returns text content on executor success', async () => {
    const executor = makeExecutor({ success: true, output: { answer: 42 } })
    const tools = [makeTool({ name: 'good_tool' })]

    buildMcpBridge(tools, executor, baseCtx)

    const handler = mockTool.mock.calls[0][3] as Function
    const result = await handler({ query: 'hello' })

    expect(executor.execute).toHaveBeenCalledWith('good_tool', { query: 'hello' }, baseCtx)
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ answer: 42 }) }],
    })
  })

  // 4. Handler error from executor
  it('returns isError when executor reports failure', async () => {
    const executor = makeExecutor({ success: false, error: 'permission denied' })
    const tools = [makeTool({ name: 'fail_tool' })]

    buildMcpBridge(tools, executor, baseCtx)

    const handler = mockTool.mock.calls[0][3] as Function
    const result = await handler({})

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: permission denied' }],
      isError: true,
    })
  })

  // 5. Handler exception
  it('catches executor exceptions and returns isError', async () => {
    const executor = {
      execute: vi.fn().mockRejectedValue(new Error('network timeout')),
    }
    const tools = [makeTool({ name: 'throw_tool' })]

    buildMcpBridge(tools, executor, baseCtx)

    const handler = mockTool.mock.calls[0][3] as Function
    const result = await handler({})

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: network timeout' }],
      isError: true,
    })
  })

  // 6. Empty tools array
  it('works with an empty tools array', () => {
    const server = buildMcpBridge([], makeExecutor(), baseCtx) as any

    expect(mockTool).not.toHaveBeenCalled()
    expect(mockCreateSdkMcpServer).toHaveBeenCalledWith({
      name: 'eyas',
      version: '1.0.0',
      tools: [],
    })
  })

  // 7. Server has correct name
  it('creates MCP server named "eyas"', () => {
    const tools = [makeTool()]
    const server = buildMcpBridge(tools, makeExecutor(), baseCtx) as any

    expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1)
    const opts = mockCreateSdkMcpServer.mock.calls[0][0]
    expect(opts.name).toBe('eyas')
    expect(opts.version).toBe('1.0.0')
  })

  // Edge: non-Error thrown in handler
  it('handles non-Error thrown values in handler', async () => {
    const executor = {
      execute: vi.fn().mockRejectedValue('string error'),
    }
    const tools = [makeTool({ name: 'str_throw' })]

    buildMcpBridge(tools, executor, baseCtx)

    const handler = mockTool.mock.calls[0][3] as Function
    const result = await handler({})

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: string error' }],
      isError: true,
    })
  })

  // Edge: tool with no properties in inputSchema
  it('handles tool with empty properties object', () => {
    const tools = [
      makeTool({
        name: 'no_props',
        inputSchema: { type: 'object', properties: {} },
      }),
    ]

    buildMcpBridge(tools, makeExecutor(), baseCtx)

    const shape = mockTool.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(shape)).toEqual([])
  })

  // Edge: tool with missing properties key in schema
  it('handles tool with no properties key in inputSchema', () => {
    const tools = [
      makeTool({
        name: 'bare_schema',
        inputSchema: { type: 'object' },
      }),
    ]

    buildMcpBridge(tools, makeExecutor(), baseCtx)

    const shape = mockTool.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(shape)).toEqual([])
  })

  // Edge: executor success with undefined output
  it('serializes empty object when output is undefined', async () => {
    const executor = makeExecutor({ success: true, output: undefined })
    const tools = [makeTool({ name: 'void_tool' })]

    buildMcpBridge(tools, executor, baseCtx)

    const handler = mockTool.mock.calls[0][3] as Function
    const result = await handler({})

    expect(result).toEqual({
      content: [{ type: 'text', text: '{}' }],
    })
  })
})
