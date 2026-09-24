// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The CLI-MCP bridge through the REAL auth stack. Every earlier bridge test
// exercised the routes on a bare Hono app, which is how the deny-by-default
// session catch-all 401'd every Grok/Kimi tools/list in production
// ('Authentication required') without a single test noticing.
//
// The live CLI lane (tests/live/cli-isolation.live.test.ts, free case "EYAS
// tools reach grok through the MCP bridge…") proves the same end to end:
// the real grok under its EYAS-owned GROK_HOME calls eyas memory_search
// through this bridge behind the real auth stack, and no 'Authentication
// required' comes back.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Hono } from 'hono'
import pino from 'pino'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import {
  BRIDGE_SECRET_HEADER,
  BRIDGE_SECRET_TTL_MS,
  CLI_MCP_TOOLS_CALL_PATH,
  CLI_MCP_TOOLS_LIST_PATH,
  buildAcpMcpServerConfig,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  revokeBridgeSecret,
  type BridgeBinding,
} from '@modules/model/cli-mcp/bridge-routes'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import { createMemoryDb } from '../../helpers/test-db'
import { allowAllBridgeGate } from '../../helpers/bridge-gate'

const logger = pino({ level: 'silent' })

const BINDING: BridgeBinding = {
  conversationId: 'conv-1',
  agentId: 'agent-1',
  userId: 'user-1',
  projectId: 'project-1',
  turnId: 'turn-1',
  runId: 'run-1',
}

function memorySearchStub(): ToolImplementation {
  return {
    name: 'memory_search',
    description: 'Search EYAS memory',
    category: 'memory',
    riskTier: 'green',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async () => ({ results: [] }),
  }
}

let app: Hono<any>
let calls: Array<{ name: string; args: Record<string, unknown>; ctx: ToolContext }>

beforeEach(() => {
  app = new Hono<any>()
  app.onError(errorHandler)
  createAuthRoutes(app, {
    db: createMemoryDb(),
    registry: createPermissionRegistry(),
    tokenService: createTokenService('test-secret-that-is-at-least-32-characters-long!'),
    sessionDuration: 86400,
    accessTokenDuration: 900,
    refreshTokenDuration: 2592000,
  })
  // Registered AFTER the auth catch-all, as in the real boot order.
  const registry = createToolRegistry()
  registry.register(memorySearchStub())
  calls = []
  registerCliMcpBridgeRoutes({
    http: app as unknown as Hono,
    toolRegistry: registry,
    toolExecutor: {
      execute: async (name: string, args: Record<string, unknown>, ctx?: ToolContext) => {
        calls.push({ name, args, ctx: ctx! })
        return { success: true, output: { results: [{ id: 'vt:1', text: 'remembered' }] }, durationMs: 1 }
      },
      // The executor's real answer serialisation (no privacy module here).
      renderForModel: createToolExecutor(registry, { authorization: 'disabled' }).renderForModel,
    } as any,
    getSecurityGate: allowAllBridgeGate,
    logger,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CLI-MCP bridge behind the session-auth catch-all', () => {
  it('a valid bridge secret lists memory_search (200)', async () => {
    const secret = issueBridgeSecret(BINDING)
    const res = await app.request(CLI_MCP_TOOLS_LIST_PATH, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
    expect(res.status).toBe(200)
    const body = await res.json() as { tools: Array<{ name: string }> }
    expect(body.tools.map((t) => t.name)).toContain('memory_search')
    revokeBridgeSecret(secret)
  })

  it('a valid bridge secret can call a tool (200), acting for the bound turn', async () => {
    const secret = issueBridgeSecret(BINDING)
    const res = await app.request(CLI_MCP_TOOLS_CALL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
      body: JSON.stringify({ name: 'memory_search', arguments: { query: 'q' } }),
    })
    expect(res.status).toBe(200)
    expect(calls[0].ctx).toMatchObject({ conversationId: 'conv-1', projectId: 'project-1', turnId: 'turn-1' })
    revokeBridgeSecret(secret)
  })

  it('no secret → the bridge\'s own 401, never the session "Authentication required"', async () => {
    for (const req of [
      app.request(CLI_MCP_TOOLS_LIST_PATH),
      app.request(CLI_MCP_TOOLS_CALL_PATH, { method: 'POST', body: JSON.stringify({ name: 'memory_search' }) }),
    ]) {
      const res = await req
      expect(res.status).toBe(401)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('unauthorized')
      expect(body.error).not.toBe('Authentication required')
    }
    expect(calls).toHaveLength(0)
  })

  it('a revoked secret → 401', async () => {
    const secret = issueBridgeSecret(BINDING)
    revokeBridgeSecret(secret)
    const res = await app.request(CLI_MCP_TOOLS_LIST_PATH, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('an expired secret → 401', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const secret = issueBridgeSecret(BINDING)
    vi.setSystemTime(Date.now() + BRIDGE_SECRET_TTL_MS + 1000)
    const res = await app.request(CLI_MCP_TOOLS_CALL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
      body: JSON.stringify({ name: 'memory_search' }),
    })
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('every other /api/v1/internal/cli-mcp path still requires session auth — even with a bridge secret', async () => {
    const secret = issueBridgeSecret(BINDING)
    for (const path of [
      '/api/v1/internal/cli-mcp/anything-else',
      '/api/v1/internal/cli-mcp/tools',
      '/api/v1/internal/cli-mcp/tools/listx',
      '/api/v1/internal/cli-mcp/tools/list/',
      '/api/v1/internal/other',
    ]) {
      const res = await app.request(path, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
      expect(res.status, path).toBe(401)
      expect((await res.json() as { error: string }).error, path).toBe('Authentication required')
    }
    revokeBridgeSecret(secret)
  })
})

/** A tiny JSON-RPC client over the stdio MCP child's NDJSON streams. */
function rpcClient(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<number, (msg: any) => void>()
  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    let msg: any
    try { msg = JSON.parse(line) } catch { return }
    const resolve = pending.get(msg.id)
    if (resolve) {
      pending.delete(msg.id)
      resolve(msg)
    }
  })
  let nextId = 1
  return {
    request(method: string, params?: unknown): Promise<any> {
      const id = nextId++
      const reply = new Promise<any>((resolve, reject) => {
        pending.set(id, resolve)
        setTimeout(() => reject(new Error(`no reply to ${method}`)), 10_000)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      return reply
    },
    notify(method: string) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
    },
    close() { rl.close() },
  }
}

describe('spawned stdio MCP child → real HTTP server → bridge', () => {
  it('initialize → tools/list → tools/call memory_search round-trip', async () => {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (req) => app.fetch(req) })
    const secret = issueBridgeSecret(BINDING)
    const cfg = buildAcpMcpServerConfig({ baseUrl: `http://127.0.0.1:${server.port}`, secret })
    const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
    for (const e of cfg.env) env[e.name] = e.value
    const child = spawn(cfg.command, cfg.args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    const rpc = rpcClient(child)
    try {
      const init = await rpc.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
      expect(init.result.serverInfo.name).toBe('eyas')
      expect(init.result.instructions).toMatch(/EYAS memory is the only memory/)
      expect(init.result.instructions).toMatch(/memory_search/)
      rpc.notify('notifications/initialized')

      const list = await rpc.request('tools/list')
      expect(list.error).toBeUndefined()
      expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('memory_search')

      const call = await rpc.request('tools/call', { name: 'memory_search', arguments: { query: 'what did we decide' } })
      expect(call.error).toBeUndefined()
      expect(call.result.isError).toBe(false)
      expect(call.result.content[0].text).toContain('remembered')

      expect(calls).toHaveLength(1)
      expect(calls[0].args).toEqual({ query: 'what did we decide' })
      expect(calls[0].ctx).toMatchObject({
        conversationId: 'conv-1',
        agentId: 'agent-1',
        userId: 'user-1',
        projectId: 'project-1',
        turnId: 'turn-1',
        runId: 'run-1',
      })

      // Revoked mid-session (the turn ended): the child's next call fails.
      revokeBridgeSecret(secret)
      const after = await rpc.request('tools/list')
      expect(after.error?.message).toMatch(/401/)
    } finally {
      rpc.close()
      child.kill()
      server.stop(true)
      revokeBridgeSecret(secret)
    }
  }, 20_000)
})
