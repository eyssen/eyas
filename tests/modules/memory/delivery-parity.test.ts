// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I12 — provider parity of memory drill-down. ONE memory fixture, ONE
// conversation in project P, and the model's memory_search / memory_expand
// calls reaching EYAS three ways:
//   (1) native: the EYAS executor with the agent runner's tool context;
//   (2) Claude Code: the in-process MCP bridge the provider builds from the
//       request metadata (the SDK is faked; the provider code is real);
//   (3) Grok / Kimi: the ACP bridge route, behind a secret bound server-side
//       to the turn exactly as those providers bind it.
// All three must hand the model the byte-identical answer, lock it to P (+ its
// type + global) whatever project the caller claims, refuse another
// project's id, and log the same drill-down rows under their own turn — the
// rows the context inspector counts per turn.

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ options: undefined as any }))

// Claude Code's SDK: query() records its options; tool()/createSdkMcpServer()
// keep each bridged tool's handler so the test calls it the way the runtime would.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { Hono } from 'hono'
import pino from 'pino'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { retrieve } from '@modules/memory/v2/retrieve'
import { expandMemoryId } from '@modules/memory/v2/expand'
import { createMemoryTools, MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolContext } from '@modules/tools/types'
import type { ModelRequestMetadata } from '@modules/model/types'
import { requestToolScope } from '@modules/agent/tool-scope'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'
import {
  BRIDGE_SECRET_HEADER,
  CLI_MCP_TOOLS_CALL_PATH,
  bridgeBindingFromMetadata,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  revokeBridgeSecret,
} from '@modules/model/cli-mcp/bridge-routes'
import { TEST_CLAUDE_RUNTIME } from '../../helpers/claude-runtime.js'
import { allowAllBridgeGate } from '../../helpers/bridge-gate'
import { makeD1Db, gistRow, vaultRow } from './v2/d1-fixtures'
import { silentLogger } from './v2/helpers'

beforeAll(async () => { await initZstd() })

const GOLD = 'Northwind invoice correction rule: MODIFY keeps the original invoice number.'
const logger = pino({ level: 'silent' })

/** A model tool call: its name and arguments. */
type Call = { name: 'memory_search' | 'memory_expand'; args: Record<string, unknown> }

/** The turn every path runs: search, then open the project note, then open the global one. */
const TURN: Call[] = [
  { name: 'memory_search', args: { query: GOLD, limit: 10 } },
  { name: 'memory_expand', args: { id: 'vt:projects/p/northwind.md' } },
  { name: 'memory_expand', args: { id: 'vt:semantic/northwind.md' } },
]

const TOOL_DEFS = [
  { name: 'memory_search', description: 'search', inputSchema: { type: 'object' } },
  { name: 'memory_expand', description: 'expand', inputSchema: { type: 'object' } },
]

let db: any
let executor: ReturnType<typeof createToolExecutor>
let registry: ReturnType<typeof createToolRegistry>
let http: Hono

beforeEach(() => {
  h.options = undefined
  // Retrieval decays with age: one frozen clock, so the three paths score
  // the same notes at the same moment.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T10:00:00Z'))
  ;({ db } = makeD1Db())
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id) VALUES ('conv-p', 'P')`)
  // Project P, its type T, global — and project Q, which P must never see.
  vaultRow(db, 'projects/p/northwind.md', `${GOLD} (P copy)`, 'P')
  vaultRow(db, 'types/t/northwind.md', `${GOLD} (type T)`, null, 'T')
  vaultRow(db, 'semantic/northwind.md', GOLD)
  vaultRow(db, 'projects/q/northwind.md', `${GOLD} (Q copy)`, 'Q')
  gistRow(db, 'g-q', 'Q private supplier terms', { project: 'Q', projectType: 'T' })
  gistRow(db, 'g-p', 'P invoicing decision', { project: 'P', projectType: 'T' })

  // The memory service as memory.onStart exposes it to the tools.
  const service = {
    db,
    retrieve: (opts: any) => retrieve({ db, logger: silentLogger }, opts),
    expand: (id: string, opts: any) => expandMemoryId(db, id, opts),
  }
  registry = createToolRegistry()
  for (const t of createMemoryTools(() => service)) registry.register(t)
  // The executor as the tools module wires it (CASL gate off here; the
  // privacy module off, so every path answers raw).
  executor = createToolExecutor(registry, { authorization: 'disabled' })
  http = new Hono()
  registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: executor, getSecurityGate: allowAllBridgeGate, logger })
})

afterEach(() => { vi.useRealTimers() })

/** The request metadata the agent runner stamps for one turn. */
function metadata(turnId: string, projectId: string | null = 'P'): ModelRequestMetadata {
  return { conversationId: 'conv-p', userId: 'owner-1', projectId, turnId } as ModelRequestMetadata
}

/** (1) Native: the runner's execContext, and the text it hands the model. */
async function viaNative(turnId: string, calls: Call[], projectId: string | null = 'P'): Promise<string[]> {
  const md = metadata(turnId, projectId)
  const ctx: ToolContext = {
    conversationId: md.conversationId!,
    userId: md.userId!,
    projectId,
    logger: logger as any,
    actor: { kind: 'agent', role: 'agent' },
    securityPipelineHandled: true,
    allowedTools: new Set(TOOL_DEFS.map((t) => t.name)),
    turnId,
  }
  const out: string[] = []
  for (const c of calls) {
    const result = await executor.execute(c.name, c.args, ctx)
    // agent-runner.ts finishExecutedTool: JSON of the output, or 'Error: …'.
    out.push(result.success ? JSON.stringify(result.output) : `Error: ${result.error}`)
  }
  return out
}

/** (2) Claude Code: the provider's own in-process bridge for this request. */
async function viaClaudeCode(turnId: string, calls: Call[], projectId: string | null = 'P'): Promise<string[]> {
  const provider = createClaudeCodeProvider({
    runtime: TEST_CLAUDE_RUNTIME,
    toolExecutor: executor,
    toolRegistry: registry,
    getGovernance: () => ({ securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) } }) as any,
  })
  for await (const _ of provider.stream({
    messages: [{ role: 'user', content: 'what is the invoice rule?' }],
    tools: TOOL_DEFS as any,
    metadata: metadata(turnId, projectId),
  })) { /* drain */ }
  const bridged = (h.options?.mcpServers?.eyas?.tools ?? []) as Array<{ name: string; handler: (a: unknown) => Promise<any> }>
  expect(bridged.map((t) => t.name).sort()).toEqual(['memory_expand', 'memory_search'])
  const out: string[] = []
  for (const c of calls) {
    const res = await bridged.find((t) => t.name === c.name)!.handler(c.args)
    out.push(res.content[0].text)
  }
  return out
}

/** (3) Grok / Kimi: the ACP bridge route, with the secret those providers issue. */
async function viaAcpBridge(turnId: string, calls: Call[], projectId: string | null = 'P'): Promise<string[]> {
  const secret = issueBridgeSecret({
    ...bridgeBindingFromMetadata(metadata(turnId, projectId)),
    toolScope: requestToolScope({ tools: TOOL_DEFS }),
  })
  try {
    const out: string[] = []
    for (const c of calls) {
      const res = await http.request(CLI_MCP_TOOLS_CALL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
        body: JSON.stringify({ name: c.name, arguments: c.args }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { content: Array<{ text: string }>; isError: boolean }
      out.push(body.content[0].text)
    }
    return out
  } finally {
    revokeBridgeSecret(secret)
  }
}

/** The drill-down rows one turn left in memory_access_log, without the turn id. */
function drillRows(turnId: string): Array<{ memory: string; call: number; conv: string | null }> {
  return (db.all(sql`SELECT memory_type, memory_id, context_task_id, rank_detail_json FROM memory_access_log
    WHERE action = 'drilldown_read' AND json_extract(rank_detail_json, '$.turnId') = ${turnId} ORDER BY id`) as any[])
    .map((r) => ({ memory: `${r.memory_type}:${r.memory_id}`, call: JSON.parse(r.rank_detail_json).call, conv: r.context_task_id }))
}

function hitIds(searchText: string): string[] {
  return (JSON.parse(searchText).results as Array<{ id: string }>).map((r) => r.id)
}

describe('memory drill-down parity across the three tool paths', () => {
  it('(+) identical memory_search / memory_expand answers, locked to P + type + global, on every path', async () => {
    const native = await viaNative('turn-native', TURN)
    const claude = await viaClaudeCode('turn-claude', TURN)
    const acp = await viaAcpBridge('turn-acp', TURN)

    expect(claude).toEqual(native)
    expect(acp).toEqual(native)

    const ids = hitIds(native[0])
    expect(ids).toEqual(expect.arrayContaining(['vt:projects/p/northwind.md', 'vt:types/t/northwind.md', 'vt:semantic/northwind.md']))
    expect(ids).not.toContain('vt:projects/q/northwind.md')
    expect(JSON.parse(native[1]).content).toContain('(P copy)')
    expect(JSON.parse(native[2]).content).toBe(GOLD)
  })

  it('(+) every path logs the same drill-down rows, under its own turn, with the call ordinal', async () => {
    await viaNative('turn-native', TURN)
    await viaClaudeCode('turn-claude', TURN)
    await viaAcpBridge('turn-acp', TURN)
    const native = drillRows('turn-native')
    expect(native.length).toBeGreaterThan(2)
    expect(new Set(native.map((r) => r.call))).toEqual(new Set([1, 2, 3]))
    expect(native.every((r) => r.conv === 'conv-p')).toBe(true)
    expect(drillRows('turn-claude')).toEqual(native)
    expect(drillRows('turn-acp')).toEqual(native)
  })

  it('(+) the per-turn cap is the same on every path: a fourth call is refused with the same text', async () => {
    const four: Call[] = [...TURN, { name: 'memory_search', args: { query: GOLD } }]
    const refusals = [
      (await viaNative('turn-n4', four))[3],
      (await viaClaudeCode('turn-c4', four))[3],
      (await viaAcpBridge('turn-a4', four))[3],
    ]
    expect(new Set(refusals).size).toBe(1)
    expect(JSON.parse(refusals[0]).error).toBe(`memory_search is limited to ${MEMORY_DRILL_LIMIT} memory tool calls per turn`)
  })

  it('(−) a cross-project id is refused on all three paths, with the same answer, and nothing is logged for it', async () => {
    const cross: Call[] = [
      { name: 'memory_expand', args: { id: 'vt:projects/q/northwind.md' } },
      { name: 'memory_expand', args: { id: 'gs:g-q' } },
    ]
    const native = await viaNative('turn-xn', cross)
    const claude = await viaClaudeCode('turn-xc', cross)
    const acp = await viaAcpBridge('turn-xa', cross)
    expect(claude).toEqual(native)
    expect(acp).toEqual(native)
    for (const text of native) {
      expect(JSON.parse(text).error).toBe('not found or out of project scope')
      expect(text).not.toContain('Q copy')
      expect(text).not.toContain('private supplier')
    }
    for (const turn of ['turn-xn', 'turn-xc', 'turn-xa']) expect(drillRows(turn)).toEqual([])
  })

  it('(−) a caller that claims project Q still gets P\'s lock on every path (the scope is the conversation\'s)', async () => {
    const claimQ: Call[] = [
      { name: 'memory_search', args: { query: GOLD, limit: 10 } },
      { name: 'memory_expand', args: { id: 'vt:projects/q/northwind.md' } },
    ]
    const honest = await viaNative('turn-honest', claimQ, 'P')
    const native = await viaNative('turn-qn', claimQ, 'Q')
    const claude = await viaClaudeCode('turn-qc', claimQ, 'Q')
    const acp = await viaAcpBridge('turn-qa', claimQ, 'Q')
    expect(native).toEqual(honest)
    expect(claude).toEqual(honest)
    expect(acp).toEqual(honest)
    expect(hitIds(honest[0])).not.toContain('vt:projects/q/northwind.md')
    expect(JSON.parse(honest[1]).error).toBe('not found or out of project scope')
  })
})
