// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// R1A-04 / R1A-10 — a Grok or Kimi call to an EYAS tool over the stdio MCP
// bridge gets what the same call gets on the API path (the agent runner's own
// loop) and on Claude Code (the shared permission bridge behind canUseTool):
// the same verdict, the same approval row, the same park of an autonomous
// supervised run, and the same do-not-repeat skip on a resumed run.
//
// Each path runs in a world of its own — the real executor, a real autonomy
// policy on an in-memory database, one scripted gate verdict — so the
// approval rows of the two runner paths can be compared field by field.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import pino from 'pino'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import {
  BRIDGE_SECRET_HEADER,
  CLI_MCP_TOOLS_CALL_PATH,
  bridgeBindingFromMetadata,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  revokeBridgeSecret,
  type BridgeToolOutcome,
} from '@modules/model/cli-mcp/bridge-routes'
import { createPermissionBridge, isAutonomousRequest, type BridgeDecision } from '@modules/model/permission-bridge'
import { createAutonomyPolicy, createAutonomyTables } from '@modules/security-gate/autonomy-policy.js'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolImplementation } from '@modules/tools/types'
import { argHash, toolLedgerKey } from '@shared/arg-hash.js'
import type { ModelGateway, ModelRequest, ModelRequestMetadata, ModelResponse, StreamEvent } from '@modules/model/types'
import { createMemoryDb } from '../../../helpers/test-db'

const logger = pino({ level: 'silent' })

/**
 * email_send: requiresApproval, category email_send (L1, max L2).
 * restart_service: category deploy_retry (up to L3).
 * send_invoice: category payment (locked at L1).
 */
const TOOLS: Array<Omit<ToolImplementation, 'execute'>> = [
  { name: 'email_send', description: 'Send an email', category: 'communication', riskTier: 'yellow', requiresApproval: true, inputSchema: { type: 'object' } },
  { name: 'restart_service', description: 'Restart a service', category: 'custom', riskTier: 'yellow', inputSchema: { type: 'object' } },
  { name: 'send_invoice', description: 'Send an invoice', category: 'custom', riskTier: 'yellow', inputSchema: { type: 'object' } },
]

interface Verdict {
  decision: 'allow' | 'escalate'
  riskTier: 'green' | 'yellow' | 'red'
}

/** One path's world: the real executor and autonomy policy, a scripted gate, the bridge routes. */
function world(verdict: Verdict, levels: Record<string, 1 | 2 | 3> = {}) {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const policy = createAutonomyPolicy(db)
  policy.seedDefaults()
  for (const [category, level] of Object.entries(levels)) policy.setLevel(category, level, 'test')
  const gate = {
    validateToolCall: vi.fn(async () => ({ decision: verdict.decision, reason: verdict.decision === 'escalate' ? 'needs review' : 'ok', riskTier: verdict.riskTier })),
    autonomyPolicy: policy,
  }
  const ran: Array<{ name: string; input: Record<string, unknown> }> = []
  const registry = createToolRegistry()
  for (const tool of TOOLS) {
    registry.register({ ...tool, execute: async (input) => { ran.push({ name: tool.name, input }); return { ok: true } } } as ToolImplementation)
  }
  const executor = createToolExecutor(registry, {
    authorization: { getSecurityGate: () => gate, getAbilityForRole: () => ({ can: () => true }) },
  })
  const http = new Hono()
  registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: executor, getSecurityGate: () => gate, logger })
  const approvals = () => db.all(sql`SELECT tool_name, category, conversation_id, agent_id, run_id, arg_hash, input_json, reason, status FROM autonomy_approvals ORDER BY id`) as Array<Record<string, unknown>>
  return { gate, policy, executor, http, ran, approvals }
}
type World = ReturnType<typeof world>

interface Scenario {
  tool: string
  input: Record<string, unknown>
  metadata: ModelRequestMetadata
  autonomous?: boolean
  ledger?: ReadonlySet<string>
}

const RUN_ID = 'run-parity'
const INTERACTIVE: ModelRequestMetadata = { conversationId: 'conv-1', userId: 'user-1', agentId: 'agent-1', origin: 'interactive' }
const SCHEDULED: ModelRequestMetadata = { conversationId: 'conv-1', userId: 'user-1', agentId: 'agent-1', origin: 'scheduled' }

function textResponse(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'mock', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

function gatewayOf(stream: (request: ModelRequest) => AsyncIterable<StreamEvent>): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only') },
    stream,
  } as unknown as ModelGateway
}

/** The API path: the model asks for the tool, the runner's own loop decides and runs it. */
function apiGateway(s: Scenario): ModelGateway {
  let turn = 0
  return gatewayOf(async function* () {
    turn++
    if (turn === 1) {
      yield { type: 'done', response: { ...textResponse(''), content: [{ type: 'tool_use', id: 'tu-1', name: s.tool, input: s.input }] as any, stopReason: 'tool_use' } }
    } else {
      yield { type: 'done', response: textResponse('finished') }
    }
  })
}

/**
 * The Grok/Kimi path: the CLI runs its own loop and calls the EYAS tool
 * through the stdio MCP child, i.e. a tools/call on the bridge route under a
 * secret bound to the turn — wired exactly as both providers wire it
 * (bridgeBindingFromMetadata + an onToolOutcome that hands an approval to the
 * runner's park sink).
 */
function bridgedGateway(w: World, s: Scenario, outcomes: BridgeToolOutcome[]): ModelGateway {
  return gatewayOf(async function* (request) {
    const secret = issueBridgeSecret({
      ...bridgeBindingFromMetadata(request.metadata),
      onToolOutcome: (outcome) => {
        outcomes.push(outcome)
        if (outcome.outcome === 'approval_required' && outcome.approvalId !== undefined) {
          request.metadata?.onEscalatedApproval?.(outcome.approvalId, outcome.toolName)
        }
      },
    })
    try {
      await w.http.request(CLI_MCP_TOOLS_CALL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
        body: JSON.stringify({ name: s.tool, arguments: s.input }),
      })
    } finally {
      revokeBridgeSecret(secret)
    }
    yield { type: 'done', response: textResponse('the CLI answered') }
  })
}

async function runWith(w: World, gateway: ModelGateway, s: Scenario): Promise<AgentEvent[]> {
  const runner = createAgentRunner({
    gateway,
    toolExecutor: w.executor,
    securityGate: w.gate,
    autonomyPolicy: w.policy,
    logger: logger as any,
    eventStore: { append: vi.fn(async () => {}), latestSeq: vi.fn(async () => 0), getByTypes: vi.fn(async () => []) } as any,
    checkpoint: { shouldAutoCheckpoint: vi.fn(() => false), createCheckpoint: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
  })
  const events: AgentEvent[] = []
  for await (const e of runner.run({
    messages: [{ role: 'user', content: 'do it' }],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    maxTurns: 3,
    sessionId: RUN_ID,
    metadata: s.metadata,
    ...(s.autonomous ? { autonomous: true } : {}),
    ...(s.ledger ? { idempotencyLedger: s.ledger } : {}),
    toolContext: { conversationId: s.metadata.conversationId!, userId: s.metadata.userId!, agentId: s.metadata.agentId, logger: logger as any },
  })) events.push(e)
  return events
}

type Ending = 'ran' | 'approval_required' | 'skipped'

interface PathResult {
  ending: Ending
  parked: boolean
  ran: number
  approvals: Array<Record<string, unknown>>
}

async function viaApi(verdict: Verdict, s: Scenario, levels?: Record<string, 1 | 2 | 3>): Promise<PathResult> {
  const w = world(verdict, levels)
  const events = await runWith(w, apiGateway(s), s)
  const settled = events.find((e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result')
  const ending: Ending = events.some((e) => e.type === 'approval_required')
    ? 'approval_required'
    : settled?.outcome === 'skipped' ? 'skipped' : 'ran'
  return { ending, parked: events.some((e) => e.type === 'parked_for_approval'), ran: w.ran.length, approvals: w.approvals() }
}

async function viaBridge(verdict: Verdict, s: Scenario, levels?: Record<string, 1 | 2 | 3>): Promise<PathResult & { outcomes: BridgeToolOutcome[] }> {
  const w = world(verdict, levels)
  const outcomes: BridgeToolOutcome[] = []
  const events = await runWith(w, bridgedGateway(w, s, outcomes), s)
  const ending: Ending = outcomes.find((o) => o.outcome === 'approval_required')
    ? 'approval_required'
    : outcomes.find((o) => o.outcome === 'skipped') ? 'skipped' : 'ran'
  return { ending, parked: events.some((e) => e.type === 'parked_for_approval'), ran: w.ran.length, approvals: w.approvals(), outcomes }
}

/** Claude Code: its canUseTool is the shared permission bridge, built from the request metadata. */
async function viaClaudeCodeGate(verdict: Verdict, s: Scenario, levels?: Record<string, 1 | 2 | 3>): Promise<Ending> {
  const w = world(verdict, levels)
  const decisions: BridgeDecision[] = []
  const canUseTool = createPermissionBridge({
    validateToolCall: w.gate.validateToolCall,
    autonomy: w.policy,
    autonomous: isAutonomousRequest({ ...s.metadata, ...(s.autonomous ? { autonomous: true } : {}) }),
    ctx: { conversationId: s.metadata.conversationId, agentId: s.metadata.agentId, runId: RUN_ID },
    ledger: s.ledger,
    onDecision: (d) => decisions.push(d),
  })
  const verdictOf = await canUseTool(`mcp__eyas__${s.tool}`, s.input, { toolUseID: 'tu-1', signal: new AbortController().signal })
  if (verdictOf.behavior === 'allow') return 'ran'
  return decisions[0]?.outcome === 'skipped' ? 'skipped' : 'approval_required'
}

/** The fields an approval row must agree on across paths. */
const rowKey = (rows: Array<Record<string, unknown>>) =>
  rows.map(({ tool_name, category, conversation_id, agent_id, run_id, arg_hash, input_json, status }) => ({ tool_name, category, conversation_id, agent_id, run_id, arg_hash, input_json, status }))

describe('CLI-MCP bridge — approval parity with the API and Claude Code paths (R1A-04)', () => {
  it('(+) an attended chat runs a requiresApproval tool the gate allows, on every path — no approval row', async () => {
    const verdict: Verdict = { decision: 'allow', riskTier: 'yellow' }
    const s: Scenario = { tool: 'email_send', input: { to: 'a@example.com' }, metadata: INTERACTIVE }
    const api = await viaApi(verdict, s)
    const bridge = await viaBridge(verdict, s)
    expect(api).toMatchObject({ ending: 'ran', ran: 1, approvals: [] })
    expect(bridge).toMatchObject({ ending: 'ran', ran: 1, approvals: [], outcomes: [] })
    expect(await viaClaudeCodeGate(verdict, s)).toBe('ran')
  })

  it('(−) an attended chat still waits on a human for an escalation, on every path — queued, not run, never parked', async () => {
    const verdict: Verdict = { decision: 'escalate', riskTier: 'yellow' }
    const s: Scenario = { tool: 'email_send', input: { to: 'a@example.com' }, metadata: INTERACTIVE }
    const api = await viaApi(verdict, s)
    const bridge = await viaBridge(verdict, s)
    expect(api).toMatchObject({ ending: 'approval_required', parked: false, ran: 0 })
    expect(bridge).toMatchObject({ ending: 'approval_required', parked: false, ran: 0 })
    expect(api.approvals).toHaveLength(1)
    expect(bridge.approvals).toHaveLength(1)
    expect(bridge.approvals[0]).toMatchObject({ tool_name: 'email_send', run_id: RUN_ID, conversation_id: 'conv-1', status: 'pending' })
    expect(bridge.outcomes[0]).toMatchObject({ toolName: 'email_send', outcome: 'approval_required', approvalId: expect.any(Number) })
    expect(await viaClaudeCodeGate(verdict, s)).toBe('approval_required')
  })

  it('(+) an autonomous supervised run parks on an escalation the same way on both runner paths, with the same approval row', async () => {
    const verdict: Verdict = { decision: 'escalate', riskTier: 'yellow' }
    const s: Scenario = { tool: 'send_invoice', input: { invoice: 'INV-1' }, metadata: SCHEDULED, autonomous: true }
    const api = await viaApi(verdict, s)
    const bridge = await viaBridge(verdict, s)
    expect(api).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(bridge).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(rowKey(bridge.approvals)).toEqual(rowKey(api.approvals))
    expect(bridge.approvals[0]).toMatchObject({ category: 'payment', run_id: RUN_ID, agent_id: 'agent-1', input_json: JSON.stringify({ invoice: 'INV-1' }) })
    expect(await viaClaudeCodeGate(verdict, s)).toBe('approval_required')
  })

  it('(−) an escalation waits on a human even in a category unlocked at L3, on every path', async () => {
    const verdict: Verdict = { decision: 'escalate', riskTier: 'yellow' }
    const s: Scenario = { tool: 'restart_service', input: { name: 'web' }, metadata: SCHEDULED, autonomous: true }
    const levels = { deploy_retry: 3 } as const
    const api = await viaApi(verdict, s, levels)
    const bridge = await viaBridge(verdict, s, levels)
    expect(api).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(bridge).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(await viaClaudeCodeGate(verdict, s, levels)).toBe('approval_required')
  })

  it('(+) the autonomy ladder decides a gate-allowed call of an autonomous run: L1 parks and L3 runs, on every path', async () => {
    const verdict: Verdict = { decision: 'allow', riskTier: 'yellow' }
    const s: Scenario = { tool: 'restart_service', input: { name: 'web' }, metadata: SCHEDULED, autonomous: true }
    const [apiL1, bridgeL1] = [await viaApi(verdict, s), await viaBridge(verdict, s)]
    expect(apiL1).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(bridgeL1).toMatchObject({ ending: 'approval_required', parked: true, ran: 0 })
    expect(rowKey(bridgeL1.approvals)).toEqual(rowKey(apiL1.approvals))
    expect(await viaClaudeCodeGate(verdict, s)).toBe('approval_required')

    const levels = { deploy_retry: 3 } as const
    expect(await viaApi(verdict, s, levels)).toMatchObject({ ending: 'ran', parked: false, ran: 1, approvals: [] })
    expect(await viaBridge(verdict, s, levels)).toMatchObject({ ending: 'ran', parked: false, ran: 1, approvals: [] })
    expect(await viaClaudeCodeGate(verdict, s, levels)).toBe('ran')
  })
})

describe('CLI-MCP bridge — the do-not-repeat ledger of a resumed run (R1A-10)', () => {
  const verdict: Verdict = { decision: 'allow', riskTier: 'green' }
  const done = { invoice: 'INV-7' }
  const ledger = new Set([toolLedgerKey('send_invoice', done)])

  it('(+) a call the original run already executed is skipped, not run, on every path', async () => {
    const s: Scenario = { tool: 'send_invoice', input: done, metadata: INTERACTIVE, ledger }
    const api = await viaApi(verdict, s)
    const bridge = await viaBridge(verdict, s)
    expect(api).toMatchObject({ ending: 'skipped', ran: 0, approvals: [] })
    expect(bridge).toMatchObject({ ending: 'skipped', ran: 0, approvals: [] })
    expect(bridge.outcomes).toEqual([{ toolName: 'send_invoice', outcome: 'skipped', reason: 'send_invoice: already executed on the original run — duplicate side effect prevented' }])
    expect(await viaClaudeCodeGate(verdict, s)).toBe('skipped')
  })

  it('(−) another input of the same tool, or no ledger at all, runs', async () => {
    const other: Scenario = { tool: 'send_invoice', input: { invoice: 'INV-8' }, metadata: INTERACTIVE, ledger }
    expect(await viaApi(verdict, other)).toMatchObject({ ending: 'ran', ran: 1 })
    expect(await viaBridge(verdict, other)).toMatchObject({ ending: 'ran', ran: 1, outcomes: [] })
    const fresh: Scenario = { tool: 'send_invoice', input: done, metadata: INTERACTIVE }
    expect(await viaBridge(verdict, fresh)).toMatchObject({ ending: 'ran', ran: 1, outcomes: [] })
  })

  it('(+) the ledger has the last word after an approval too: a granted repeat on a resumed run is still skipped', async () => {
    // The gate escalates, and an operator already granted exactly this call:
    // the grant lets it through the approval, and the ledger then refuses it.
    const w = world({ decision: 'escalate', riskTier: 'yellow' })
    const id = w.policy.createApproval({ category: 'payment', toolName: 'send_invoice', conversationId: 'conv-1', inputJson: JSON.stringify(done), argHash: argHash(done), runId: RUN_ID })
    w.policy.decide(id, 'approved', 'operator')
    const outcomes: BridgeToolOutcome[] = []
    const s: Scenario = { tool: 'send_invoice', input: done, metadata: INTERACTIVE, ledger }
    await runWith(w, bridgedGateway(w, s, outcomes), s)
    expect(outcomes.map((o) => o.outcome)).toEqual(['skipped'])
    expect(w.ran).toEqual([])
  })
})
