// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D5 — memory parity across channels. ONE memory item (an email, a phone
// number, an IBAN, a valid adószám and a date) reaches a remote model four
// ways: (1) injected into the system prompt and passed through the gateway's
// egress filter, (2) as a native memory_search tool_result through the same
// filter, (3) through Claude Code's in-process MCP bridge and (4) through the
// Grok/Kimi ACP bridge route. All four must deliver the identical masked item
// text, with the date intact. With a local provider, (1) and (2) stay raw.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import pino from 'pino'
import { createEgressFilter } from '@modules/privacy/egress-filter'
import type { AIProvider, ModelRequest } from '@modules/model/types'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import {
  BRIDGE_SECRET_HEADER,
  CLI_MCP_TOOLS_CALL_PATH,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  revokeBridgeSecret,
} from '@modules/model/cli-mcp/bridge-routes'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'
import { allowAllBridgeGate } from '../../helpers/bridge-gate'

// Claude Code's SDK: keep each bridged tool's handler so the test can call it.
const sdkTools: Array<{ name: string; handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> = []
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _d: string, _s: unknown, handler: any) => {
    const t = { name, handler }
    sdkTools.push(t)
    return t
  },
  createSdkMcpServer: (opts: unknown) => opts,
}))

const EMAIL = 'billing@example.com'
const PHONE = '+36 30 123 4567'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const TAX = '12345676-2-42'
const DATE = '2026-09-08'
const ITEM = `Invoice contact ${EMAIL}, phone ${PHONE}, IBAN ${IBAN}, adószám ${TAX}, paid ${DATE}`
const RAW_VALUES = [EMAIL, PHONE, IBAN, TAX]

const MEMORY_OUTPUT = { hits: [{ id: 'gs:42', text: ITEM, score: 0.93 }], total: 1 }

function provider(host: string): AIProvider {
  return { id: 'p', name: 'p', listModels: async () => [], complete: vi.fn() as any, stream: vi.fn() as any, egressHost: () => host }
}
const REMOTE = provider('api.example-vendor.com')
const LOCAL = provider('127.0.0.1')

const memorySearch: ToolImplementation = {
  name: 'memory_search',
  description: 'Search EYAS memory',
  category: 'memory',
  riskTier: 'green',
  memoryBearing: true,
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async () => MEMORY_OUTPUT,
}

let fx: PrivacyFixture
afterEach(() => {
  fx?.cleanup()
  sdkTools.length = 0
})

function setup() {
  fx = createPrivacyFixture({})
  const registry = createToolRegistry()
  registry.register(memorySearch)
  // The executor exactly as the tools module wires it (CASL gate off here).
  const executor = createToolExecutor(registry, {
    authorization: 'disabled',
    getModelOutputRedactor: () => fx.service.redactToolOutput,
  })
  const MEMORY_SECTION = `<memory-context>\n- ${ITEM}\n</memory-context>`
  const filter = createEgressFilter({
    service: fx.service,
    getToolRegistry: () => registry,
    getRecorder: () => ({ sectionsFor: (id) => (id === 'comp-1' ? [{ ord: 0, key: 'memory', content: MEMORY_SECTION }] : null) }),
    logger: { debug: vi.fn() },
  })
  return { registry, executor, filter, MEMORY_SECTION }
}

/** (1) The assembled memory section, as the gateway sends it. */
function viaSystemPrompt(s: ReturnType<typeof setup>, to: AIProvider): string {
  const req: ModelRequest = {
    model: 'm',
    system: `<runtime>\n- Current date: ${DATE}\n</runtime>\n\n${s.MEMORY_SECTION}`,
    messages: [{ role: 'user', content: 'what do we know about the invoice?' }],
    metadata: { compositionId: 'comp-1' },
  } as ModelRequest
  const out = s.filter.request(req, to)
  const line = String(out.system).split('\n').find((l) => l.startsWith('- Invoice'))
  return line!.slice(2)
}

/** (2) A native-loop memory_search tool_result, as the gateway sends it. */
function viaNativeToolResult(s: ReturnType<typeof setup>, to: AIProvider): string {
  const req: ModelRequest = {
    model: 'm',
    messages: [
      { role: 'user', content: 'look it up' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'memory_search', input: { query: 'invoice' } }] },
      // The agent runner's serialisation: JSON.stringify(result.output).
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu-1', content: JSON.stringify(MEMORY_OUTPUT) }] },
    ],
  } as ModelRequest
  const out = s.filter.request(req, to)
  const block = (out.messages[2].content as any[])[0]
  return JSON.parse(block.content).hits[0].text
}

/** (3) Claude Code's in-process MCP bridge. */
async function viaClaudeCodeBridge(s: ReturnType<typeof setup>): Promise<string> {
  const { buildMcpBridge } = await import('@modules/model/submodules/claude-code/mcp-bridge')
  const ctx: ToolContext = { conversationId: 'conv-1', userId: 'u', logger: pino({ level: 'silent' }) as any, actor: { kind: 'agent', role: 'agent' } }
  buildMcpBridge([memorySearch], s.executor, ctx)
  const result = await sdkTools.find((t) => t.name === 'memory_search')!.handler({ query: 'invoice' })
  expect(result.isError).toBeUndefined()
  return JSON.parse(result.content[0].text).hits[0].text
}

/** (4) The Grok/Kimi ACP bridge route. */
async function viaAcpBridge(s: ReturnType<typeof setup>): Promise<string> {
  const http = new Hono()
  registerCliMcpBridgeRoutes({ http, toolRegistry: s.registry, toolExecutor: s.executor, getSecurityGate: allowAllBridgeGate, logger: pino({ level: 'silent' }) })
  const secret = issueBridgeSecret({ conversationId: 'conv-1', runId: 'run-1' })
  try {
    const res = await http.request(CLI_MCP_TOOLS_CALL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
      body: JSON.stringify({ name: 'memory_search', arguments: { query: 'invoice' } }),
    })
    const body = await res.json() as { content: Array<{ text: string }>; isError: boolean }
    expect(body.isError).toBe(false)
    return JSON.parse(body.content[0].text).hits[0].text
  } finally {
    revokeBridgeSecret(secret)
  }
}

describe('memory parity across the four channels', () => {
  it('(+) all four deliver the identical masked item text, the date intact', async () => {
    const s = setup()
    const texts = [
      viaSystemPrompt(s, REMOTE),
      viaNativeToolResult(s, REMOTE),
      await viaClaudeCodeBridge(s),
      await viaAcpBridge(s),
    ]
    expect(new Set(texts).size).toBe(1)
    const [masked] = texts
    expect(masked).toBe(`Invoice contact [EMAIL], phone [PHONE], IBAN [IBAN], adószám [TAX_NUMBER], paid ${DATE}`)
    for (const value of RAW_VALUES) expect(masked).not.toContain(value)
  })

  it('(−) a local provider gets (1) and (2) raw; the CLI bridges are never local', async () => {
    const s = setup()
    expect(viaSystemPrompt(s, LOCAL)).toBe(ITEM)
    expect(viaNativeToolResult(s, LOCAL)).toBe(ITEM)
    expect(await viaAcpBridge(s)).not.toContain(EMAIL)
    expect(await viaClaudeCodeBridge(s)).not.toContain(EMAIL)
  })
})
