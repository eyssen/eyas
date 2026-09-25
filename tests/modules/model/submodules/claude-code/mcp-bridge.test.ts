// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ToolImplementation, ToolContext } from '@modules/tools/types.js'
import { createToolExecutor, type ExecutionResult, type ModelOutputRedactor } from '@modules/tools/tool-executor.js'
import { createToolRegistry } from '@modules/tools/tool-registry.js'
import { createPrivacyFixture, type PrivacyFixture } from '../../../../helpers/privacy-service'

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

/** The executor's real renderForModel over `tools` (memoryBearing read from them). */
function renderer(tools: ToolImplementation[] = [], redact?: ModelOutputRedactor) {
  const registry = createToolRegistry()
  for (const t of tools) registry.register(t)
  return createToolExecutor(registry, {
    authorization: 'disabled',
    ...(redact ? { getModelOutputRedactor: () => redact } : {}),
  }).renderForModel
}

function makeExecutor(result?: Partial<ExecutionResult>, renderForModel = renderer()) {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: { data: 'ok' },
      durationMs: 42,
      ...result,
    }),
    renderForModel,
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

  // 1. Bridges exactly the tools it is given: which ones is the provider's
  //    decision (selectBridgeTools), made once — no second filter here.
  it('bridges every tool it is given, a browser or shell-category tool included', () => {
    const tools: ToolImplementation[] = [
      makeTool({ name: 'mem_search', category: 'memory' }),
      makeTool({ name: 'opencode_run', category: 'shell' }),
      makeTool({ name: 'browser_navigate', category: 'browser' }),
    ]

    buildMcpBridge(tools, makeExecutor(), baseCtx)

    const convertedNames = mockTool.mock.calls.map(c => c[0])
    expect(convertedNames).toEqual(['mem_search', 'opencode_run', 'browser_navigate'])
  })

  it('bridges nothing it was not given (negative)', () => {
    buildMcpBridge([makeTool({ name: 'mem_search', category: 'memory' })], makeExecutor(), baseCtx)
    const convertedNames = mockTool.mock.calls.map(c => c[0])
    expect(convertedNames).toEqual(['mem_search'])
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
      renderForModel: renderer(),
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
      renderForModel: renderer(),
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

// D5 — a bridged answer goes from EYAS to the Claude Code CLI and on to its
// vendor, never through the gateway's egress filter, so the executor's
// renderForModel masks memory-bearing output (remote) and nothing else.
describe('MCP Bridge — memory masking (renderForModel)', () => {
  const EMAIL = 'billing@example.com'
  const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
  const HIT = { hits: [{ id: 'gs:1', text: `2026-09-08 invoice contact ${EMAIL}, account ${IBAN}`, score: 0.9 }] }
  let buildMcpBridge: typeof import('@modules/model/submodules/claude-code/mcp-bridge.js').buildMcpBridge
  let fx: PrivacyFixture | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    buildMcpBridge = (await import('@modules/model/submodules/claude-code/mcp-bridge.js')).buildMcpBridge
  })
  afterEach(() => {
    fx?.cleanup()
    fx = undefined
  })

  const memorySearch = makeTool({ name: 'memory_search', category: 'memory' })
  const searchIndexed = makeTool({ name: 'search_indexed', category: 'search' })
  memorySearch.memoryBearing = true

  async function bridged(name: string, output: unknown, redact?: ModelOutputRedactor, ctx: ToolContext = { ...baseCtx, runId: 'run-1', agentId: 'agent-1', turnId: 'turn-1' }) {
    const executor = makeExecutor({ success: true, output: output as ExecutionResult['output'] }, renderer([memorySearch, searchIndexed], redact))
    buildMcpBridge([memorySearch, searchIndexed], executor, ctx)
    const handler = mockTool.mock.calls.find((c) => c[0] === name)![3] as Function
    return handler({ query: 'invoice' }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>
  }

  it('(+) a bridged memory_search comes back masked, keys and date intact', async () => {
    fx = createPrivacyFixture({})
    const result = await bridged('memory_search', HIT, fx.service.redactToolOutput)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({
      hits: [{ id: 'gs:1', text: '2026-09-08 invoice contact [EMAIL], account [IBAN]', score: 0.9 }],
    })
  })

  it('(+) the redactor gets the query\'s identity and the mcp-bridge transport', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    await bridged('memory_search', HIT, redact)
    expect(redact).toHaveBeenCalledTimes(1)
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'mcp-bridge', conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1', turnId: 'turn-1' })
    expect(redact.mock.results[0].value.digest).toMatchObject({ toolName: 'memory_search', conversationId: 'conv-1', byType: { email: 1, iban: 1 } })
  })

  it('(−) a bridged search_indexed (not memory-bearing) is byte-identical', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    const result = await bridged('search_indexed', HIT, redact)
    expect(result.content[0].text).toBe(JSON.stringify(HIT))
    expect(redact).not.toHaveBeenCalled()
  })

  it('(−) no privacy module: the memory result goes out raw', async () => {
    const result = await bridged('memory_search', HIT)
    expect(result.content[0].text).toBe(JSON.stringify(HIT))
  })
})
