// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import pino from 'pino'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { setupGuard } from '@modules/setup/middleware'
import {
  BRIDGE_SECRET_HEADER,
  checkCliMcpBridge,
  getBridgeBinding,
  registerCliMcpBridgeRoutes,
  selfTestCliMcpBridge,
} from '@modules/model/cli-mcp/bridge-routes'
import { createToolRegistry } from '@modules/tools/tool-registry'
import type { ToolImplementation } from '@modules/tools/types'
import { createMemoryDb } from '../helpers/test-db'
import { allowAllBridgeGate } from '../helpers/bridge-gate'

const silent = pino({ level: 'silent' })

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn() }
}

function memorySearchStub(): ToolImplementation {
  return {
    name: 'memory_search',
    description: 'Search EYAS memory',
    category: 'memory',
    riskTier: 'green',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({}),
  }
}

function mountBridge(app: Hono<any>) {
  const registry = createToolRegistry()
  registry.register(memorySearchStub())
  registerCliMcpBridgeRoutes({
    http: app as unknown as Hono,
    toolRegistry: registry,
    toolExecutor: { execute: async () => ({ success: true, durationMs: 0 }), renderForModel: () => ({ text: '{}', isError: false }) } as any,
    getSecurityGate: allowAllBridgeGate,
    logger: silent,
  })
}

/** Setup guard + real auth catch-all + bridge, in the real boot order. */
function realStack(setupComplete = true): Hono<any> {
  const app = new Hono<any>()
  app.onError(errorHandler)
  app.use('*', setupGuard({ isComplete: () => setupComplete } as any))
  createAuthRoutes(app, {
    db: createMemoryDb(),
    registry: createPermissionRegistry(),
    tokenService: createTokenService('test-secret-that-is-at-least-32-characters-long!'),
    sessionDuration: 86400,
    accessTokenDuration: 900,
    refreshTokenDuration: 2592000,
  })
  mountBridge(app)
  return app
}

describe('CLI-MCP bridge boot self-test', () => {
  it('healthy stack → healthy:true, no warning', async () => {
    const logger = fakeLogger()
    const health = await checkCliMcpBridge({ http: realStack(), logger: logger as any, setupComplete: () => true })
    expect(health.healthy).toBe(true)
    expect(health.error).toBeUndefined()
    expect(health.toolCount).toBe(1)
    expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()
  })

  it('a session-auth catch-all without the bridge exemption → healthy:false and a warning', async () => {
    const app = new Hono<any>()
    app.onError(errorHandler)
    app.use('/api/v1/*', async () => {
      throw new HTTPException(401, { message: 'Authentication required' })
    })
    mountBridge(app)
    const logger = fakeLogger()
    const health = await checkCliMcpBridge({ http: app, logger: logger as any, setupComplete: () => true })
    expect(health.healthy).toBe(false)
    expect(health.error).toMatch(/401/)
    expect(health.error).toMatch(/Authentication required/)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ error: expect.stringMatching(/401/) })
  })

  it('bridge routes not mounted → healthy:false', async () => {
    const app = new Hono<any>()
    const health = await selfTestCliMcpBridge(app)
    expect(health.healthy).toBe(false)
    expect(health.error).toMatch(/404/)
  })

  it('stdio server file missing → healthy:false, even when the routes answer', async () => {
    const missing = join(tmpdir(), 'eyas-no-such-dir', 'stdio-mcp-server.js')
    const logger = fakeLogger()
    const health = await checkCliMcpBridge({ http: realStack(), logger: logger as any, serverPath: missing })
    expect(health.healthy).toBe(false)
    expect(health.error).toContain(missing)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('an unexpected tools/list body → healthy:false', async () => {
    const app = { request: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }) }
    expect((await selfTestCliMcpBridge(app as any)).healthy).toBe(false)
  })

  it('setup incomplete → deferred, logged at info, no warning, no request made', async () => {
    const request = vi.fn()
    const logger = fakeLogger()
    const health = await checkCliMcpBridge({ http: { request } as any, logger: logger as any, setupComplete: () => false })
    expect(health).toMatchObject({ healthy: false, deferred: true })
    expect(request).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()
  })

  it('revokes its probe secret after the check', async () => {
    let probe: string | undefined
    const app = {
      request: async (_path: string, init: { headers: Record<string, string> }) => {
        probe = init.headers[BRIDGE_SECRET_HEADER]
        expect(getBridgeBinding(probe!)).toBeDefined()
        return new Response(JSON.stringify({ tools: [] }), { status: 200 })
      },
    }
    const health = await selfTestCliMcpBridge(app as any)
    expect(health.healthy).toBe(true)
    expect(probe).toBeDefined()
    expect(getBridgeBinding(probe!)).toBeUndefined()
  })
})
