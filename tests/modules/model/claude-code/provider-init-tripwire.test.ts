// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A4 — the init tripwire. The CLI's system/init message says what it actually
// loaded. Anything outside the isolation contract aborts the query with a
// terminal CliIsolationError before one token of the answer is yielded, and
// the outcome (with the CLI's own version) is recorded as the provider's
// isolation status.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  captured: { options: undefined as any },
  // Built per test from the captured options: the messages the fake CLI sends.
  script: (_options: any): any[] => [],
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      for (const msg of h.script(args.options)) yield msg
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { CliIsolationError, getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import { fakeClaudeInit } from '../../../helpers/claude-sdk-init.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const answer = [
  { type: 'assistant', message: { content: [{ type: 'text', text: 'SECRET-ANSWER' }] } },
  { type: 'result', subtype: 'success', result: 'SECRET-ANSWER', usage: { input_tokens: 1, output_tokens: 1 } },
]

function provider() {
  return createClaudeCodeProvider({
    runtime: TEST_CLAUDE_RUNTIME,
    toolExecutor: { execute: vi.fn() } as any,
    toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
    getGovernance: () => ({ securityGate: { validateToolCall: () => ({ decision: 'allow', reason: 'ok', riskTier: 'green' }) } }) as any,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
  })
}

const req = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

async function run(request: any = req): Promise<{ events: any[]; error: unknown }> {
  const events: any[] = []
  try {
    for await (const ev of provider().stream(request)) events.push(ev)
    return { events, error: undefined }
  } catch (error) {
    return { events, error }
  }
}

beforeEach(() => {
  h.captured.options = undefined
  resetIsolationStatuses()
})

describe('claude-code init tripwire', () => {
  it('proceeds when init reports only the eyas server, no plugins, default mode and the resolved cwd', async () => {
    h.script = (o) => [fakeClaudeInit(o, { claude_code_version: '2.1.281' }), ...answer]
    const { events, error } = await run()
    expect(error).toBeUndefined()
    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['SECRET-ANSWER'])
    expect(h.captured.options.mcpServers).toHaveProperty('eyas')
    const status = getIsolationStatus('claude-code')
    expect(status.status).toBe('verified')
    // The version the CLI itself reported, on the resolved binary.
    expect(status.runtime).toEqual({ path: TEST_CLAUDE_RUNTIME.path, version: '2.1.281', source: TEST_CLAUDE_RUNTIME.source })
  })

  it('an MCP server EYAS did not configure aborts the query with no text yielded', async () => {
    h.script = (o) => [fakeClaudeInit(o, { mcp_servers: [{ name: 'eyas', status: 'connected' }, { name: 'mcpvault', status: 'connected' }] }), ...answer]
    const { events, error } = await run()
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['mcpServers'])
    expect(events.some((e) => e.type === 'text' || e.type === 'done')).toBe(false)
    expect(h.captured.options.abortController.signal.aborted).toBe(true)
    const status = getIsolationStatus('claude-code')
    expect(status.status).toBe('violation')
    expect(status.checks[0]).toMatchObject({ check: 'mcpServers', detail: expect.stringContaining('mcpvault') })
  })

  it('bypassPermissions is a violation', async () => {
    h.script = (o) => [fakeClaudeInit(o, { permissionMode: 'bypassPermissions' }), ...answer]
    const { events, error } = await run()
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['permissionMode'])
    expect(events.some((e) => e.type === 'text')).toBe(false)
  })

  it('a loaded plugin or another working directory is a violation', async () => {
    h.script = (o) => [fakeClaudeInit(o, { plugins: [{ name: 'host-plugin', path: '/p' }], cwd: '/' }), ...answer]
    const { error } = await run()
    expect((error as CliIsolationError).violations.map((v) => v.check).sort()).toEqual(['cwd', 'plugins'])
  })

  it('an isolated call reporting any MCP server is a violation', async () => {
    h.script = (o) => [fakeClaudeInit(o, { mcp_servers: [{ name: 'eyas', status: 'connected' }] }), ...answer]
    const { error } = await run({ ...req, isolated: true })
    expect(h.captured.options.mcpServers).toBeUndefined()
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['mcpServers'])
  })

  it('an answer that arrives before any init fails closed', async () => {
    h.script = () => [...answer]
    const { events, error } = await run()
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['initMissing'])
    expect(events.some((e) => e.type === 'text')).toBe(false)
    expect(getIsolationStatus('claude-code').status).toBe('violation')
  })

  // With partial messages on, a stream_event delta IS the first token of the
  // answer — it must not reach the caller before the init was checked.
  it('a streamed delta that arrives before any init fails closed without yielding its text', async () => {
    h.script = () => [
      { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm0', model: 'claude-sonnet', usage: { input_tokens: 1 } } } },
      { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SECRET-DELTA' } } },
      ...answer,
    ]
    const { events, error } = await run()
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations).toEqual([expect.objectContaining({ check: 'initMissing', detail: expect.stringContaining('stream_event') })])
    expect(events).toEqual([])
  })

  it('asks the runtime for partial messages, so text streams live', async () => {
    h.script = (o) => [fakeClaudeInit(o), ...answer]
    await run()
    expect(h.captured.options.includePartialMessages).toBe(true)
  })

  it('a violation is terminal: the gateway classifies it as a non-retryable isolation failure', async () => {
    h.script = (o) => [fakeClaudeInit(o, { permissionMode: 'acceptEdits' }), ...answer]
    const { error } = await run()
    const c = classifyModelError(error)
    expect(c.kind).toBe('isolation')
    expect(c.retryable).toBe(false)
    expect(c.code).toBe('cliIsolation')
  })
})
