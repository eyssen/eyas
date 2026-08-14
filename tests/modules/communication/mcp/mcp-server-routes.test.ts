// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createMcpServer } from '@modules/communication/submodules/mcp-server/server'
import { createToolRegistry } from '@modules/tools/tool-registry'
import type { ToolImplementation } from '@modules/tools/types'

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
}

const echoTool: ToolImplementation = {
  name: 'echo',
  description: 'Echo the input back',
  category: 'custom',
  riskTier: 'green',
  inputSchema: { type: 'object', properties: { a: {} } },
  execute: async (input) => ({ echoed: input }),
}

function setup(opts: { ability?: { can: (a: string, s: string) => boolean }; role?: string } = {}) {
  const app = new Hono()
  if (opts.ability) {
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', opts.ability)
      ;(c as any).set('role', opts.role ?? 'admin')
      ;(c as any).set('userId', 'operator-1')
      await next()
    })
  }
  const toolRegistry = createToolRegistry()
  toolRegistry.register(echoTool)
  const execute = vi.fn(async (_name: string, _input: Record<string, unknown>, _ctx?: unknown) => ({
    success: true,
    output: { echoed: { a: 1 } },
    durationMs: 3,
  }))
  const server = createMcpServer({
    toolRegistry,
    toolExecutor: { execute } as any,
    logger: silentLogger,
    http: app as any,
  })
  return { app, server, execute }
}

const allow = { can: () => true }
const readOnly = { can: (action: string, subject: string) => action === 'read' && subject === 'Tool' }

async function connected(opts: Parameters<typeof setup>[0] = {}) {
  const h = setup(opts)
  await h.server.connect()
  return h
}

function callBody(name: string, args: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 7, params: { name, arguments: args } }),
  }
}

describe('MCP server routes — authenticated + CASL-gated (F0 R2)', () => {
  it('401s on /api/v1/mcp/tools/list without an ability on the context', async () => {
    const { app } = await connected()
    const res = await app.request('/api/v1/mcp/tools/list')
    expect(res.status).toBe(401)
  })

  it('lists tools with a read-capable ability', async () => {
    const { app } = await connected({ ability: readOnly })
    const res = await app.request('/api/v1/mcp/tools/list')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name)).toContain('echo')
  })

  it('403s on tools/call when the ability cannot execute Tool — the executor is never reached', async () => {
    const { app, execute } = await connected({ ability: readOnly, role: 'user' })
    const res = await app.request('/api/v1/mcp/tools/call', callBody('echo', { a: 1 }))
    expect(res.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes with the real request actor when the ability allows execute Tool', async () => {
    const { app, execute } = await connected({ ability: allow, role: 'admin' })
    const res = await app.request('/api/v1/mcp/tools/call', callBody('echo', { a: 1 }))
    expect(res.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
    const ctx = execute.mock.calls[0][2] as any
    expect(ctx.actor).toEqual(expect.objectContaining({ kind: 'external', role: 'admin', ability: allow }))
    expect(ctx.securityPipelineHandled).toBeFalsy()
  })

  it('returns JSON-RPC -32601 / 404 for an unknown tool', async () => {
    const { app } = await connected({ ability: allow })
    const res = await app.request('/api/v1/mcp/tools/call', callBody('nope'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32601)
  })

  it('no longer serves the legacy unauthenticated /mcp/* routes', async () => {
    const { app } = await connected({ ability: allow })
    expect((await app.request('/mcp/tools/list')).status).toBe(404)
    expect((await app.request('/mcp/tools/call', callBody('echo'))).status).toBe(404)
    expect((await app.request('/mcp/info')).status).toBe(404)
  })

  it('gates /api/v1/mcp/info behind read Tool', async () => {
    const { app: unauth } = await connected()
    expect((await unauth.request('/api/v1/mcp/info')).status).toBe(401)

    const { app } = await connected({ ability: readOnly })
    const res = await app.request('/api/v1/mcp/info')
    expect(res.status).toBe(200)
    expect((await res.json() as { name: string }).name).toBe('EYAS')
  })
})
