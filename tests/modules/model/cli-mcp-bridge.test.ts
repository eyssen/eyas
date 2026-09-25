// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { Hono } from 'hono'
import pino from 'pino'
import {
  BRIDGE_SECRET_HEADER,
  BRIDGE_SECRET_TTL_MS,
  CLI_MCP_TOOLS_CALL_PATH,
  CLI_MCP_TOOLS_LIST_PATH,
  bridgeBindingFromMetadata,
  buildAcpMcpServerConfig,
  getBridgeBinding,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  resolveBridgeBaseUrl,
  resolveStdioMcpServerPath,
  revokeBridgeSecret,
  type BridgeBinding,
} from '@modules/model/cli-mcp/bridge-routes'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, MEMORY_RESULT_WITHHELD, type ModelOutputRedactor } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const logger = pino({ level: 'silent' })

/**
 * A security gate that allows every call, with an autonomy ladder that leaves
 * every tool uncategorized: the permission bridge never stands in the way, on
 * an attended or an autonomous turn alike.
 */
const ALLOW_GATE = {
  validateToolCall: vi.fn(async () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' as const })),
  autonomyPolicy: {
    categoryForTool: () => null,
    resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
    createApproval: vi.fn(),
  },
}

function stubTool(name: string, category: ToolImplementation['category'] = 'memory'): ToolImplementation {
  return {
    name,
    description: `${name} stub`,
    category,
    riskTier: 'green',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  }
}

function bridgeApp() {
  const registry = createToolRegistry()
  registry.register(stubTool('memory_search'))
  registry.register(stubTool('run_command', 'shell'))
  const calls: Array<{ name: string; args: Record<string, unknown>; ctx: ToolContext }> = []
  const execute = vi.fn(async (name: string, args: Record<string, unknown>, ctx?: ToolContext) => {
    calls.push({ name, args, ctx: ctx! })
    return { success: true, output: { hits: 1 }, durationMs: 1 }
  })
  const http = new Hono()
  registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: { execute, renderForModel: renderer(registry) } as any, getSecurityGate: () => ALLOW_GATE, logger })
  return { http, execute, calls }
}

/** The executor's real renderForModel over `registry`, optionally with a privacy redactor. */
function renderer(registry: ToolRegistry, redact?: ModelOutputRedactor, log?: pino.Logger) {
  return createToolExecutor(registry, {
    authorization: 'disabled',
    ...(redact ? { getModelOutputRedactor: () => redact } : {}),
    ...(log ? { logger: log } : {}),
  }).renderForModel
}

function callTool(http: Hono, secret: string, body: unknown, headers: Record<string, string> = {}) {
  return http.request(CLI_MCP_TOOLS_CALL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const BINDING: BridgeBinding = {
  conversationId: 'conv-P',
  agentId: 'agent-1',
  teamSessionId: 'team-1',
  userId: 'user-1',
  projectId: 'project-P',
  turnId: 'turn-1',
  runId: 'run-1',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('bridge secrets', () => {
  it('issues unique secrets', () => {
    const a = issueBridgeSecret({})
    const b = issueBridgeSecret({})
    expect(a).not.toBe(b)
    expect(a.startsWith('eyas-mcp-')).toBe(true)
    revokeBridgeSecret(a)
    revokeBridgeSecret(b)
  })

  it('draws secrets from the CSPRNG, not from a time-seeded generator', () => {
    const secrets = Array.from({ length: 50 }, () => issueBridgeSecret({}))
    expect(new Set(secrets).size).toBe(50)

    // The secret authenticates a bridge session, so it needs real entropy:
    // at least 128 bits of random material after the prefix.
    for (const s of secrets) {
      expect(s.slice('eyas-mcp-'.length).length).toBeGreaterThanOrEqual(22)
    }

    // It must not encode the clock. Secrets built from Date.now() share a prefix
    // when issued in the same millisecond, which narrows a guess enormously.
    const stamp = Date.now().toString(36)
    expect(secrets.filter((s) => s.includes(stamp))).toHaveLength(0)

    secrets.forEach(revokeBridgeSecret)
  })

  it('stores the binding server-side, as a copy the caller cannot change later', () => {
    const binding: BridgeBinding = { ...BINDING }
    const secret = issueBridgeSecret(binding)
    binding.conversationId = 'conv-other'
    expect(getBridgeBinding(secret)).toEqual(BINDING)
    revokeBridgeSecret(secret)
  })

  it('a revoked secret has no binding', () => {
    const secret = issueBridgeSecret(BINDING)
    revokeBridgeSecret(secret)
    expect(getBridgeBinding(secret)).toBeUndefined()
  })

  it('an unrevoked secret expires once unused for the TTL; each use starts it over (G8)', () => {
    vi.useFakeTimers()
    const secret = issueBridgeSecret(BINDING)
    vi.advanceTimersByTime(BRIDGE_SECRET_TTL_MS - 1000)
    expect(getBridgeBinding(secret)).toEqual(BINDING)
    // Used a second ago: still live past the TTL counted from its issue.
    vi.advanceTimersByTime(2000)
    expect(getBridgeBinding(secret)).toEqual(BINDING)
    vi.advanceTimersByTime(BRIDGE_SECRET_TTL_MS + 1)
    expect(getBridgeBinding(secret)).toBeUndefined()
  })

  it('maps request metadata to a binding, including project, turn, run, origin and folders', () => {
    // B2: the folders ride along server-side (the gate's memory-path policy and
    // the bridged tools' jail use them); so do the origin and its
    // classification (a team session is never human-attended).
    expect(bridgeBindingFromMetadata({ ...BINDING, origin: 'interactive', workingDirectory: '/w' })).toEqual({
      ...BINDING,
      origin: 'interactive',
      autonomous: true,
      workingDirectories: ['/w'],
    })
    expect(bridgeBindingFromMetadata(undefined)).toEqual({
      conversationId: undefined,
      agentId: undefined,
      teamSessionId: undefined,
      userId: undefined,
      projectId: undefined,
      turnId: undefined,
      runId: undefined,
      autonomous: true,
    })
  })

  it('(+) classifies an attended turn as interactive and an unlabelled or background one as autonomous', () => {
    expect(bridgeBindingFromMetadata({ conversationId: 'c', origin: 'interactive' }).autonomous).toBe(false)
    expect(bridgeBindingFromMetadata({ conversationId: 'c', origin: 'channel' }).autonomous).toBe(false)
    expect(bridgeBindingFromMetadata({ conversationId: 'c', origin: 'scheduled' }).autonomous).toBe(true)
    // (−) No label, or an explicit autonomous flag over an interactive origin: autonomous.
    expect(bridgeBindingFromMetadata({ conversationId: 'c' }).autonomous).toBe(true)
    expect(bridgeBindingFromMetadata({ conversationId: 'c', origin: 'interactive', autonomous: true }).autonomous).toBe(true)
  })

  it('(+) carries a resumed run\'s ledger as a copy; (−) an empty ledger is left out', () => {
    const ledger = new Set(['send_email:abc'])
    const binding = bridgeBindingFromMetadata({ conversationId: 'c', idempotencyLedger: ledger })
    ledger.add('send_email:def')
    expect([...(binding.idempotencyLedger ?? [])]).toEqual(['send_email:abc'])
    const secret = issueBridgeSecret(binding)
    ;(binding.idempotencyLedger as Set<string>).add('send_email:ghi')
    expect([...(getBridgeBinding(secret)?.idempotencyLedger ?? [])]).toEqual(['send_email:abc'])
    revokeBridgeSecret(secret)
    expect(bridgeBindingFromMetadata({ conversationId: 'c', idempotencyLedger: new Set() })).not.toHaveProperty('idempotencyLedger')
  })
})

describe('ACP mcpServers entry', () => {
  it('runs the stdio server under the current runtime from a module-relative path', () => {
    const cfg = buildAcpMcpServerConfig({ baseUrl: 'http://127.0.0.1:3100', secret: 'eyas-mcp-x' })
    expect(cfg.name).toBe('eyas')
    expect(cfg.command).toBe(process.execPath)
    expect(cfg.args).toHaveLength(1)
    const serverPath = cfg.args[0]
    expect(isAbsolute(serverPath)).toBe(true)
    expect(existsSync(serverPath)).toBe(true)
    expect(basename(serverPath)).toBe('stdio-mcp-server.ts')
    expect(dirname(serverPath)).toBe(resolve(process.cwd(), 'src/modules/model/cli-mcp'))
    expect(resolveStdioMcpServerPath()).toBe(serverPath)
  })

  it('carries only the bridge URL and secret — no tool context in the child env', () => {
    const cfg = buildAcpMcpServerConfig({ baseUrl: 'http://127.0.0.1:3100', secret: 'eyas-mcp-x' })
    const env = Object.fromEntries(cfg.env.map((e) => [e.name, e.value]))
    expect(env).toEqual({ EYAS_MCP_BRIDGE_URL: 'http://127.0.0.1:3100', EYAS_MCP_BRIDGE_SECRET: 'eyas-mcp-x' })
    expect(env).not.toHaveProperty('EYAS_MCP_TOOL_CONTEXT')
  })

  it('turns a wildcard bind address into a connectable loopback URL', () => {
    expect(resolveBridgeBaseUrl({ host: '0.0.0.0', port: 3100 })).toBe('http://127.0.0.1:3100')
    expect(resolveBridgeBaseUrl({ host: '::', port: 3100 })).toBe('http://127.0.0.1:3100')
    expect(resolveBridgeBaseUrl({ host: '', port: 3000 })).toBe('http://127.0.0.1:3000')
  })

  it('keeps an explicit host and brackets an IPv6 literal', () => {
    expect(resolveBridgeBaseUrl({ host: '127.0.0.1', port: 3100 })).toBe('http://127.0.0.1:3100')
    expect(resolveBridgeBaseUrl({ host: 'localhost', port: 3100 })).toBe('http://localhost:3100')
    expect(resolveBridgeBaseUrl({ host: '::1', port: 3100 })).toBe('http://[::1]:3100')
  })
})

describe('bridge routes', () => {
  it('builds the ToolContext from the binding, including project, turn and run', async () => {
    const { http, calls } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    const res = await callTool(http, secret, { name: 'memory_search', arguments: { query: 'x' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ content: [{ type: 'text', text: '{"hits":1}' }], isError: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('memory_search')
    expect(calls[0].args).toEqual({ query: 'x' })
    expect(calls[0].ctx).toMatchObject({
      conversationId: 'conv-P',
      agentId: 'agent-1',
      teamSessionId: 'team-1',
      userId: 'user-1',
      projectId: 'project-P',
      turnId: 'turn-1',
      runId: 'run-1',
      actor: { kind: 'agent', role: 'agent' },
    })
    // The host CLI asks no permission for MCP calls: the bridge put the call
    // through the shared permission bridge, so the executor does not judge it again.
    expect(calls[0].ctx.securityPipelineHandled).toBe(true)
    expect(ALLOW_GATE.validateToolCall).toHaveBeenCalledWith('memory_search', { query: 'x' }, expect.objectContaining({ conversationId: 'conv-P', agentId: 'agent-1', runId: 'run-1' }))
    revokeBridgeSecret(secret)
  })

  it("carries the turn's model binding from the request metadata into the bridged ToolContext (H4)", async () => {
    const { http, calls } = bridgeApp()
    const pair = { providerId: 'grok-cli', modelId: 'grok-cli-default' }
    const secret = issueBridgeSecret(bridgeBindingFromMetadata({ ...BINDING, modelBinding: pair }))
    // (−) A tools/call body cannot name another model.
    await callTool(http, secret, {
      name: 'memory_search', arguments: {},
      context: { modelBinding: { providerId: 'anthropic', modelId: 'claude-x' } },
    })
    expect(calls[0].ctx.modelBinding).toEqual(pair)
    revokeBridgeSecret(secret)

    // (−) No binding on the turn: none on the call.
    const bare = issueBridgeSecret(bridgeBindingFromMetadata(BINDING))
    await callTool(http, bare, { name: 'memory_search', arguments: {} })
    expect(calls[1].ctx.modelBinding).toBeUndefined()
    revokeBridgeSecret(bare)
  })

  it('ignores a body.context naming another conversation, project or user', async () => {
    const { http, calls } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    await callTool(http, secret, {
      name: 'memory_search',
      arguments: {},
      context: { conversationId: 'conv-Q', projectId: 'project-Q', userId: 'owner', agentId: 'agent-evil' },
    })
    expect(calls[0].ctx.conversationId).toBe('conv-P')
    expect(calls[0].ctx.projectId).toBe('project-P')
    expect(calls[0].ctx.userId).toBe('user-1')
    expect(calls[0].ctx.agentId).toBe('agent-1')
    revokeBridgeSecret(secret)
  })

  it('an empty binding still runs as the agent actor, never as a caller-named user', async () => {
    const { http, calls } = bridgeApp()
    const secret = issueBridgeSecret({})
    await callTool(http, secret, { name: 'memory_search', context: { userId: 'owner' } })
    expect(calls[0].ctx.userId).toBe('cli-mcp')
    expect(calls[0].ctx.conversationId).toBe('')
    expect(calls[0].ctx.actor).toEqual({ kind: 'agent', role: 'agent' })
    revokeBridgeSecret(secret)
  })

  it('rejects a malformed tools/call body with 400 and runs nothing', async () => {
    const { http, execute } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    expect((await callTool(http, secret, { arguments: {} })).status).toBe(400)
    expect((await callTool(http, secret, { name: '' })).status).toBe(400)
    expect((await callTool(http, secret, { name: 'memory_search', arguments: 'nope' })).status).toBe(400)
    expect((await callTool(http, secret, 'not json')).status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    revokeBridgeSecret(secret)
  })

  it('refuses an unknown tool without executing', async () => {
    const { http, execute } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    const unknown = await (await callTool(http, secret, { name: 'no_such_tool' })).json() as { isError: boolean }
    expect(unknown.isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    revokeBridgeSecret(secret)
  })

  it('tools/list hides the host-native tools', async () => {
    const { http } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    const res = await http.request(CLI_MCP_TOOLS_LIST_PATH, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
    const body = await res.json() as { tools: Array<{ name: string }> }
    expect(body.tools.map((t) => t.name)).toEqual(['memory_search'])
    revokeBridgeSecret(secret)
  })

  it('accepts loopback forwarding headers', async () => {
    const { http } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    for (const headers of <Array<Record<string, string>>>[
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-forwarded-for': '::1, 127.0.0.2' },
      { 'x-real-ip': '127.0.0.1' },
      { forwarded: 'for="[::1]:5555"' },
    ]) {
      expect((await callTool(http, secret, { name: 'memory_search' }, headers)).status).toBe(200)
    }
    revokeBridgeSecret(secret)
  })

  it('refuses a valid secret that visibly arrived from a non-loopback address', async () => {
    const { http, execute } = bridgeApp()
    const secret = issueBridgeSecret(BINDING)
    for (const headers of <Array<Record<string, string>>>[
      { 'x-forwarded-for': '203.0.113.9' },
      // A client-forged loopback first hop does not hide the real one.
      { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' },
      { 'x-real-ip': '10.0.0.5' },
      { forwarded: 'for=198.51.100.7;proto=https' },
    ]) {
      const res = await callTool(http, secret, { name: 'memory_search' }, headers)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
    const list = await http.request(CLI_MCP_TOOLS_LIST_PATH, {
      headers: { [BRIDGE_SECRET_HEADER]: secret, 'x-forwarded-for': '203.0.113.9' },
    })
    expect(list.status).toBe(401)
    expect(execute).not.toHaveBeenCalled()
    revokeBridgeSecret(secret)
  })
})

// H9 — the bridge offers the turn's tool scope minus the CLI's host-native
// tools, and the executor refuses anything else: tools/call runs with exactly
// the set tools/list served as its ToolContext.allowedTools.
describe('bridge routes — tool scope (H9)', () => {
  const allowAll = { can: () => true }
  const allowGate = ALLOW_GATE

  function scopedApp() {
    const registry = createToolRegistry()
    for (const [name, category] of <Array<[string, ToolImplementation['category']]>>[
      ['memory_search', 'memory'],
      ['run_command', 'shell'],
      ['read_file', 'shell'],
      ['opencode_run', 'shell'],
      ['browser_navigate', 'browser'],
      ['agent_browser_run', 'browser'],
      ['git_status', 'shell'],
      ['create_task', 'board'],
      ['assign_task', 'board'],
      ['run_specialist', 'agent'],
    ]) registry.register(stubTool(name, category))
    // A real executor, so the refusal is the executor's own.
    const executor = createToolExecutor(registry, {
      authorization: { getAbilityForRole: () => allowAll, getSecurityGate: () => allowGate },
    })
    const execute = vi.fn(executor.execute)
    const http = new Hono()
    registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: { execute, renderForModel: executor.renderForModel }, getSecurityGate: () => allowGate, logger })
    return { http, execute }
  }

  async function listed(http: Hono, secret: string): Promise<string[]> {
    const res = await http.request(CLI_MCP_TOOLS_LIST_PATH, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
    return ((await res.json()) as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
  }

  it('(+) tools/list honours the binding\'s scope and includes the EYAS browser and OpenCode tools', async () => {
    const { http } = scopedApp()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include: ['memory_search', 'browser_navigate', 'opencode_run', 'read_file'], exclude: [] } })
    expect(await listed(http, secret)).toEqual(['memory_search', 'opencode_run', 'browser_navigate'])
    revokeBridgeSecret(secret)
  })

  it('(+) no scope on the binding: every tool except the host-native ones', async () => {
    const { http } = scopedApp()
    const secret = issueBridgeSecret(BINDING)
    expect(await listed(http, secret)).toEqual(['memory_search', 'opencode_run', 'browser_navigate', 'agent_browser_run', 'create_task', 'assign_task', 'run_specialist'])
    revokeBridgeSecret(secret)
  })

  it('(+) K3: a scope without run_command offers git_status over the bridge, since the CLI\'s own shell is withheld', async () => {
    const { http } = scopedApp()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include: ['memory_search', 'git_status', 'read_file'], exclude: [] } })
    expect(await listed(http, secret)).toEqual(['memory_search', 'git_status'])
    revokeBridgeSecret(secret)
  })

  it('(−) K3: with run_command in the scope, git_status stays with the CLI\'s own shell', async () => {
    const { http } = scopedApp()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include: ['memory_search', 'git_status', 'run_command'], exclude: [] } })
    expect(await listed(http, secret)).toEqual(['memory_search'])
    revokeBridgeSecret(secret)
  })

  it('(−) a Solo scope offers no run_specialist, while assign_task remains', async () => {
    const { http } = scopedApp()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { exclude: ['run_specialist', 'delegate_to_agent', 'handoff_to_colleague', 'propose_team'] } })
    const names = await listed(http, secret)
    expect(names).not.toContain('run_specialist')
    expect(names).toContain('assign_task')
    revokeBridgeSecret(secret)
  })

  it('(+) a call inside the scope runs, with the served set as its toolset', async () => {
    const { http, execute } = scopedApp()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include: ['memory_search', 'browser_navigate'], exclude: [] } })
    const body = await (await callTool(http, secret, { name: 'browser_navigate', arguments: {} })).json() as { isError: boolean }
    expect(body.isError).toBe(false)
    const ctx = execute.mock.calls[0][2] as ToolContext
    expect([...(ctx.allowedTools ?? [])].sort()).toEqual(['browser_navigate', 'memory_search'])
    revokeBridgeSecret(secret)
  })

  it('(−) a call to a tool outside the scope, or to a host-native tool, is denied before the gate is asked and reported as a denial', async () => {
    const { http, execute } = scopedApp()
    allowGate.validateToolCall.mockClear()
    const onToolOutcome = vi.fn()
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include: ['memory_search', 'run_command'], exclude: [] }, onToolOutcome })
    for (const name of ['create_task', 'run_command', 'read_file']) {
      const res = await callTool(http, secret, { name, arguments: {} })
      const body = await res.json() as { content: Array<{ text: string }>; isError: boolean }
      expect(body.isError, name).toBe(true)
      expect(body.content[0].text, name).toContain("not in this agent's toolset")
    }
    expect(onToolOutcome.mock.calls.map((c) => [c[0].toolName, c[0].outcome])).toEqual([
      ['create_task', 'denied'], ['run_command', 'denied'], ['read_file', 'denied'],
    ])
    // Never judged, never run: no approval can be queued for a tool the turn was not offered.
    expect(allowGate.validateToolCall).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    revokeBridgeSecret(secret)
  })

  it('(−) the binding keeps a copy of the scope: the issuer cannot widen it later', async () => {
    const { http } = scopedApp()
    const include = ['memory_search']
    const secret = issueBridgeSecret({ ...BINDING, toolScope: { include, exclude: [] } })
    include.push('create_task')
    expect(await listed(http, secret)).toEqual(['memory_search'])
    revokeBridgeSecret(secret)
  })
})

describe('bridge routes — G3 tool outcomes reach the provider', () => {
  /** The gate escalates every call; its approval queue hands out `approvalId`. */
  function escalatingGate(approvalId = 12) {
    return {
      validateToolCall: vi.fn(async () => ({ decision: 'escalate' as const, reason: 'red: needs review', riskTier: 'red' })),
      autonomyPolicy: {
        categoryForTool: () => 'data_delete',
        resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
        createApproval: vi.fn(() => approvalId),
      },
    }
  }

  function refusingApp(result: Record<string, unknown>, gate: object = ALLOW_GATE) {
    const registry = createToolRegistry()
    registry.register(stubTool('memory_forget'))
    const execute = vi.fn(async () => ({ success: false, durationMs: 1, ...result }))
    const http = new Hono()
    registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: { execute, renderForModel: renderer(registry) } as any, getSecurityGate: () => gate as any, logger })
    return { http, execute }
  }

  it('(+) a gate escalation queues an approval stamped with the binding\'s run and calls the observer with its id; the tool never runs', async () => {
    const gate = escalatingGate(12)
    const { http, execute } = refusingApp({}, gate)
    const onToolOutcome = vi.fn()
    const secret = issueBridgeSecret({ ...BINDING, onToolOutcome })
    const body = await (await callTool(http, secret, { name: 'memory_forget', arguments: { id: 'm1' } })).json() as { content: Array<{ text: string }>; isError: boolean }
    expect(body.isError).toBe(true)
    expect(body.content[0].text).toBe('Error: approval required for memory_forget (gate escalated): red: needs review')
    expect(execute).not.toHaveBeenCalled()
    expect(gate.autonomyPolicy.createApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'memory_forget', conversationId: 'conv-P', agentId: 'agent-1', runId: 'run-1', inputJson: JSON.stringify({ id: 'm1' }),
    }))
    expect(onToolOutcome).toHaveBeenCalledWith({
      toolName: 'memory_forget',
      outcome: 'approval_required',
      reason: 'approval required for memory_forget (gate escalated): red: needs review',
      approvalId: 12,
    })
    revokeBridgeSecret(secret)
  })

  it('(−) an executor DENIED (CASL, toolset) is reported as a denial, never on the approval path', async () => {
    const { http } = refusingApp({ error: 'Tool call denied: role "agent" is not allowed to execute tools', errorCode: 'DENIED' })
    const onToolOutcome = vi.fn()
    const secret = issueBridgeSecret({ ...BINDING, onToolOutcome })
    await callTool(http, secret, { name: 'memory_forget', arguments: {} })
    expect(onToolOutcome).toHaveBeenCalledTimes(1)
    expect(onToolOutcome.mock.calls[0][0]).toEqual({ toolName: 'memory_forget', outcome: 'denied', reason: 'Tool call denied: role "agent" is not allowed to execute tools' })
    revokeBridgeSecret(secret)
  })

  it('(−) the tool\'s own failure is not a refusal, and an unknown secret calls nothing', async () => {
    const { http, execute } = refusingApp({ error: 'boom', errorCode: 'EXECUTION_ERROR' })
    const onToolOutcome = vi.fn()
    const secret = issueBridgeSecret({ ...BINDING, onToolOutcome })
    await callTool(http, secret, { name: 'memory_forget', arguments: {} })
    expect(onToolOutcome).not.toHaveBeenCalled()
    revokeBridgeSecret(secret)
    const res = await callTool(http, secret, { name: 'memory_forget', arguments: {} })
    expect(res.status).toBe(401)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(onToolOutcome).not.toHaveBeenCalled()
  })

  it('(−) a throwing observer never changes what the CLI is answered', async () => {
    const { http } = refusingApp({}, escalatingGate(3))
    const secret = issueBridgeSecret({ ...BINDING, onToolOutcome: () => { throw new Error('observer broke') } })
    const res = await callTool(http, secret, { name: 'memory_forget', arguments: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ content: [{ type: 'text', text: 'Error: approval required for memory_forget (gate escalated): red: needs review' }], isError: true })
    revokeBridgeSecret(secret)
  })

  it('(−) no security gate wired: every call is refused as a denial and nothing runs (fail-closed)', async () => {
    const registry = createToolRegistry()
    registry.register(stubTool('memory_forget'))
    const execute = vi.fn()
    const http = new Hono()
    registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: { execute, renderForModel: renderer(registry) } as any, getSecurityGate: () => undefined, logger })
    const onToolOutcome = vi.fn()
    const secret = issueBridgeSecret({ ...BINDING, onToolOutcome })
    const body = await (await callTool(http, secret, { name: 'memory_forget', arguments: {} })).json() as { content: Array<{ text: string }>; isError: boolean }
    expect(body).toEqual({ content: [{ type: 'text', text: 'Error: Tool call denied: security gate unavailable (fail-closed)' }], isError: true })
    expect(execute).not.toHaveBeenCalled()
    expect(onToolOutcome.mock.calls[0][0]).toMatchObject({ toolName: 'memory_forget', outcome: 'denied' })
    revokeBridgeSecret(secret)
  })
})

// Memory tool results leave through the host CLI straight to its vendor, never
// through the gateway's egress filter — so the executor's renderForModel masks
// them, for a remote destination, with the same mask function (privacy
// parity). The identity it records comes from the binding, never the body.
describe('bridge privacy: memory-bearing output is masked (renderForModel)', () => {
  const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
  const EMAIL = 'billing@example.com'
  const MEMORY_HIT = {
    hits: [{ id: 'gs:1', text: `2026-09-08 invoice contact ${EMAIL}, account ${IBAN}`, score: 0.9 }],
    total: 1,
  }
  let fx: PrivacyFixture | undefined
  afterEach(() => {
    fx?.cleanup()
    fx = undefined
  })

  function privacyBridgeApp(opts: { redact?: ModelOutputRedactor; log?: pino.Logger } = {}) {
    const registry = createToolRegistry()
    registry.register({ ...stubTool('memory_expand'), memoryBearing: true })
    registry.register(stubTool('browser_get_content', 'browser'))
    const execute = vi.fn(async (name: string) => ({
      success: true,
      output: name === 'browser_get_content' ? { path: '/w/a.txt', content: `pay ${IBAN} via ${EMAIL}` } : MEMORY_HIT,
      durationMs: 1,
    }))
    const http = new Hono()
    registerCliMcpBridgeRoutes({
      http,
      toolRegistry: registry,
      toolExecutor: { execute, renderForModel: renderer(registry, opts.redact, opts.log) } as any,
      getSecurityGate: () => ALLOW_GATE,
      logger: opts.log ?? logger,
    })
    return http
  }

  async function callText(http: Hono, name: string, body: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const secret = issueBridgeSecret(BINDING)
    try {
      const res = await callTool(http, secret, { name, arguments: {}, ...body })
      const json = await res.json() as { content: Array<{ text: string }>; isError: boolean }
      return { text: json.content[0].text, isError: json.isError }
    } finally {
      revokeBridgeSecret(secret)
    }
  }

  it('(+) a memory_expand result with an IBAN comes back as [IBAN], JSON keys and date intact', async () => {
    fx = createPrivacyFixture({})
    const { text, isError } = await callText(privacyBridgeApp({ redact: fx.service.redactToolOutput }), 'memory_expand')
    expect(isError).toBe(false)
    expect(text).not.toContain(IBAN)
    expect(text).not.toContain(EMAIL)
    expect(JSON.parse(text)).toEqual({
      hits: [{ id: 'gs:1', text: '2026-09-08 invoice contact [EMAIL], account [IBAN]', score: 0.9 }],
      total: 1,
    })
  })

  it('(−) a body.context claiming a local destination and another conversation changes nothing; the digest carries the binding', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    const { text } = await callText(privacyBridgeApp({ redact }), 'memory_expand', {
      context: { locality: 'local', conversationId: 'other', runId: 'run-evil' },
    })
    expect(text).toContain('[IBAN]')
    expect(text).not.toContain(IBAN)
    expect(redact).toHaveBeenCalledTimes(1)
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'mcp-bridge', conversationId: 'conv-P', runId: 'run-1', agentId: 'agent-1', turnId: 'turn-1' })
    const digest = redact.mock.results[0].value.digest
    expect(digest).toMatchObject({ toolName: 'memory_expand', transport: 'mcp-bridge', conversationId: 'conv-P', runId: 'run-1', byType: { iban: 1, email: 1 } })
    expect(JSON.stringify(digest)).not.toContain(IBAN)
    expect(JSON.stringify(digest)).not.toContain('other')
    // The privacy service logs the digest — types and identity, never a value.
    const logged = fx.logger.info.mock.calls.find((c) => /masked values/.test(String(c[1])))
    expect(logged?.[0]).toMatchObject({ toolName: 'memory_expand', conversationId: 'conv-P', transport: 'mcp-bridge' })
    expect(JSON.stringify(fx.logger.info.mock.calls)).not.toContain(IBAN)
  })

  it('(−) a workspace tool result (browser_get_content) stays byte-identical', async () => {
    fx = createPrivacyFixture({})
    const { text } = await callText(privacyBridgeApp({ redact: fx.service.redactToolOutput }), 'browser_get_content')
    expect(text).toBe(JSON.stringify({ path: '/w/a.txt', content: `pay ${IBAN} via ${EMAIL}` }))
  })

  it('(−) a disabled policy, or no privacy module, leaves the result raw', async () => {
    fx = createPrivacyFixture({ enabled: false })
    expect((await callText(privacyBridgeApp({ redact: fx.service.redactToolOutput }), 'memory_expand')).text).toBe(JSON.stringify(MEMORY_HIT))
    expect((await callText(privacyBridgeApp(), 'memory_expand')).text).toBe(JSON.stringify(MEMORY_HIT))
  })

  it('(−) a privacy scan that throws withholds the memory result (fail closed)', async () => {
    const broken: ModelOutputRedactor = () => { throw new Error('policy store gone') }
    const { text, isError } = await callText(privacyBridgeApp({ redact: broken }), 'memory_expand')
    expect(isError).toBe(true)
    expect(text).toBe(MEMORY_RESULT_WITHHELD)
    expect(text).not.toContain(IBAN)
  })
})
