// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Grok/Kimi providers issue one bridge secret per turn, bound server-side to
// the turn's identity, hand the CLI only the secret, and revoke it when the
// turn ends — however it ends.

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider'
import { getBridgeBinding } from '@modules/model/cli-mcp/bridge-routes'
import type { AcpMcpServerConfig } from '@modules/model/submodules/grok-cli/acp-client'
import type { AcpBridgeOutcomes } from '@modules/model/submodules/grok-cli/acp-stream'
import type { ModelRequest, StreamEvent } from '@modules/model/types'

const METADATA = {
  conversationId: 'conv-1',
  agentId: 'agent-1',
  teamSessionId: undefined,
  userId: 'user-1',
  projectId: 'project-1',
  turnId: 'turn-1',
  runId: 'run-1',
  origin: 'interactive' as const,
}

const REQUEST: ModelRequest = {
  messages: [{ role: 'user', content: 'what did we decide?' }],
  metadata: METADATA,
}

interface Observed {
  mcpServers?: AcpMcpServerConfig[]
  bindingDuringRun?: ReturnType<typeof getBridgeBinding>
  secret?: string
}

function secretOf(servers: AcpMcpServerConfig[] | undefined): string | undefined {
  return servers?.[0]?.env?.find((e) => e.name === 'EYAS_MCP_BRIDGE_SECRET')?.value
}

function fakeRun(observed: Observed, mode: 'ok' | 'throw' | 'long' = 'ok') {
  return async function* (opts: { mcpServers?: AcpMcpServerConfig[] }) {
    observed.mcpServers = opts.mcpServers
    observed.secret = secretOf(opts.mcpServers)
    observed.bindingDuringRun = observed.secret ? getBridgeBinding(observed.secret) : undefined
    if (mode === 'throw') throw new Error('cli crashed')
    yield { type: 'text', text: 'first' } satisfies StreamEvent
    if (mode === 'long') yield { type: 'text', text: 'second' } satisfies StreamEvent
    return { text: 'first', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
  }
}

const PROVIDERS = [
  ['grok-cli', (o: any) => createGrokCliProvider(o)],
  ['kimi-cli', (o: any) => createKimiCliProvider(o)],
] as const

describe.each(PROVIDERS)('%s bridge binding', (_id, create) => {
  it('binds the secret to the turn (incl. project, turn, run, folders) and revokes it when the turn ends', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    for await (const _ of provider.stream(REQUEST)) { /* drain */ }

    expect(observed.secret).toMatch(/^eyas-mcp-/)
    expect(observed.bindingDuringRun).toEqual({
      conversationId: 'conv-1',
      agentId: 'agent-1',
      teamSessionId: undefined,
      userId: 'user-1',
      projectId: 'project-1',
      turnId: 'turn-1',
      runId: 'run-1',
      // The origin and its classification decide every bridged call's verdict
      // the way they do on the API and Claude Code paths.
      origin: 'interactive',
      autonomous: false,
      // B2: the turn's jail roots — here the conversation's own EYAS workspace.
      workingDirectories: [join(process.env.EYAS_WORKSPACES_DIR!, 'conv-1')],
      // H9: a request that names no tools sets no allowlist.
      toolScope: { exclude: [] },
      // G3: the executor's refusals come back to this turn's tool rows.
      onToolOutcome: expect.any(Function),
    })
    expect(getBridgeBinding(observed.secret!)).toBeUndefined()
  })

  it('binds a background turn as autonomous, with the resumed run\'s do-not-repeat ledger', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    const ledger = new Set(['send_email:0123456789abcdef'])
    for await (const _ of provider.stream({ ...REQUEST, metadata: { ...METADATA, origin: 'scheduled', idempotencyLedger: ledger } })) { /* drain */ }
    expect(observed.bindingDuringRun).toMatchObject({ origin: 'scheduled', autonomous: true, runId: 'run-1' })
    expect([...(observed.bindingDuringRun?.idempotencyLedger ?? [])]).toEqual(['send_email:0123456789abcdef'])
  })

  it('(−) an interactive turn with no resume binds no ledger', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    for await (const _ of provider.stream(REQUEST)) { /* drain */ }
    expect(observed.bindingDuringRun).not.toHaveProperty('idempotencyLedger')
    expect(observed.bindingDuringRun?.autonomous).toBe(false)
  })

  it('H9: binds the tools the request offers as the bridge scope', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    const tools = ['memory_search', 'memory_expand', 'browser_navigate'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }))
    for await (const _ of provider.stream({ ...REQUEST, tools })) { /* drain */ }
    expect(observed.bindingDuringRun?.toolScope).toEqual({ include: ['memory_search', 'memory_expand', 'browser_navigate'], exclude: [] })
  })

  it('H9: a Solo request binds no delegation tools, even ones it names (negative)', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    const tools = ['memory_search', 'run_specialist', 'assign_task'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }))
    for await (const _ of provider.stream({ ...REQUEST, tools, orchestration: 'solo' })) { /* drain */ }
    const scope = observed.bindingDuringRun!.toolScope!
    expect(scope.exclude).toContain('run_specialist')
    expect(scope.exclude).not.toContain('assign_task')
  })

  it('hands the CLI a runtime-agnostic server entry with no identity in it', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    for await (const _ of provider.stream(REQUEST)) { /* drain */ }

    const [server] = observed.mcpServers!
    expect(server.name).toBe('eyas')
    expect(server.command).toBe(process.execPath)
    expect(server.args[0]).toMatch(/stdio-mcp-server\.ts$/)
    const envNames = (server.env ?? []).map((e) => e.name).sort()
    expect(envNames).toEqual(['EYAS_MCP_BRIDGE_SECRET', 'EYAS_MCP_BRIDGE_URL'])
    expect(JSON.stringify(server)).not.toContain('conv-1')
  })

  it('revokes the secret when the CLI run fails', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed, 'throw'), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    await expect((async () => { for await (const _ of provider.stream(REQUEST)) { /* drain */ } })()).rejects.toThrow('cli crashed')
    expect(observed.bindingDuringRun).toBeDefined()
    expect(getBridgeBinding(observed.secret!)).toBeUndefined()
  })

  it('revokes the secret when the consumer abandons the stream early', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed, 'long'), mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    for await (const ev of provider.stream(REQUEST)) {
      if (ev.type === 'text') break
    }
    expect(observed.bindingDuringRun).toBeDefined()
    expect(getBridgeBinding(observed.secret!)).toBeUndefined()
  })

  it('G3: an executor refusal reported to the binding reaches the turn, and an approval the runner park sink', async () => {
    const seen: unknown[] = []
    const onEscalatedApproval = vi.fn()
    const run = async function* (opts: { mcpServers?: AcpMcpServerConfig[]; bridgeOutcomes?: AcpBridgeOutcomes }) {
      const stop = opts.bridgeOutcomes!.subscribe((o) => seen.push(o))
      const binding = getBridgeBinding(secretOf(opts.mcpServers)!)!
      binding.onToolOutcome!({ toolName: 'memory_forget', outcome: 'approval_required', reason: 'approval required', approvalId: 5 })
      binding.onToolOutcome!({ toolName: 'board_delete', outcome: 'denied', reason: 'gate denied' })
      stop()
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = create({ runPrompt: run, mcpBridge: { baseUrl: 'http://127.0.0.1:3100' } })
    for await (const _ of provider.stream({ ...REQUEST, metadata: { ...METADATA, onEscalatedApproval } })) { /* drain */ }
    expect(seen).toEqual([
      { toolName: 'memory_forget', outcome: 'approval_required', reason: 'approval required', approvalId: 5 },
      { toolName: 'board_delete', outcome: 'denied', reason: 'gate denied' },
    ])
    // Only the approval parks the run; a plain denial does not (negative).
    expect(onEscalatedApproval).toHaveBeenCalledTimes(1)
    expect(onEscalatedApproval).toHaveBeenCalledWith(5, 'memory_forget')
  })

  it('without a configured bridge, offers the CLI no EYAS server and issues no secret', async () => {
    const observed: Observed = {}
    const provider = create({ runPrompt: fakeRun(observed) })
    for await (const _ of provider.stream(REQUEST)) { /* drain */ }
    expect(observed.mcpServers).toBeUndefined()
    expect(observed.secret).toBeUndefined()
  })
})
