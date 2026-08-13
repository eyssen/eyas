// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupWsServer, startAgentPostBoot, resolveWsJwtSecret, type WSData } from '@core/http/ws-server'
import { createTopicAcl } from '@core/http/ws-acl'
import { createTokenService } from '@modules/auth/token'

const JWT_SECRET = 'ws-server-test-secret-32-characters-min!'

function makeMockServer() {
  return { upgrade: vi.fn(() => true) } as any
}

function makeMockWs(data: WSData) {
  return { data, send: vi.fn(), readyState: 1, close: vi.fn() }
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    config: { auth: { jwtSecret: JWT_SECRET }, server: { host: '0.0.0.0', port: 0 } },
    bus: { on: vi.fn(() => ({ subject: 'x', id: '1', unsubscribe: vi.fn() })), emit: vi.fn(), off: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    secrets: { get: vi.fn(async () => null) },
    ...overrides,
  } as any
}

/**
 * D14 — this ONE suite exercises the extracted helper directly, which both
 * main.ts and cli/commands/serve.ts now delegate to for their WS wiring
 * (fetch()'s two upgrade branches + the `websocket` handlers object). Since
 * neither entrypoint has any WS logic of its own left, testing the helper
 * once covers both — there is nothing left in either file to test separately.
 */
describe('setupWsServer (shared WS wiring for main.ts + cli serve.ts)', () => {
  describe('resolveWsJwtSecret', () => {
    it('prefers config.auth.jwtSecret', async () => {
      const ctx = makeCtx()
      const secret = await resolveWsJwtSecret(ctx)
      expect(secret).toEqual(new TextEncoder().encode(JWT_SECRET))
      expect(ctx.secrets.get).not.toHaveBeenCalled()
    })

    it('falls back to the secrets vault when config has none', async () => {
      const ctx = makeCtx({ config: { auth: {}, server: { host: '0.0.0.0', port: 0 } }, secrets: { get: vi.fn(async () => 'vault-secret-32-characters-min!!') } })
      const secret = await resolveWsJwtSecret(ctx)
      expect(secret).toEqual(new TextEncoder().encode('vault-secret-32-characters-min!!'))
    })

    it('returns null when neither source has a secret', async () => {
      const ctx = makeCtx({ config: { auth: {}, server: { host: '0.0.0.0', port: 0 } } })
      expect(await resolveWsJwtSecret(ctx)).toBeNull()
    })
  })

  describe('handleUpgrade (/ws?token=<jwt>)', () => {
    it('upgrades a request bearing a valid token, keyed to the token\'s subject', async () => {
      const ctx = makeCtx()
      const wsServer = await setupWsServer(ctx)
      const token = await createTokenService(JWT_SECRET).signAccessToken({ sub: 'user-1', role: 'user' }, 30)
      const server = makeMockServer()

      const res = await wsServer.handleUpgrade(new Request(`http://x/ws?token=${token}`), server)

      expect(res).toBeUndefined()
      expect(server.upgrade).toHaveBeenCalledWith(expect.anything(), { data: { userId: 'user-1' } })
    })

    it('401s a missing token', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const res = await wsServer.handleUpgrade(new Request('http://x/ws'), makeMockServer())
      expect(res?.status).toBe(401)
    })

    it('401s an invalid/expired token', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const res = await wsServer.handleUpgrade(new Request('http://x/ws?token=garbage'), makeMockServer())
      expect(res?.status).toBe(401)
    })

    it('401s every upgrade when no JWT secret is available anywhere', async () => {
      const ctx = makeCtx({ config: { auth: {}, server: { host: '0.0.0.0', port: 0 } } })
      const wsServer = await setupWsServer(ctx)
      const token = await createTokenService(JWT_SECRET).signAccessToken({ sub: 'user-1', role: 'user' }, 30)
      const res = await wsServer.handleUpgrade(new Request(`http://x/ws?token=${token}`), makeMockServer())
      expect(res?.status).toBe(401)
    })
  })

  describe('handleHandUpgrade (/api/v1/hand/ws)', () => {
    function makeHandHub(verifies = true) {
      return { pairing: { verifyToken: vi.fn(() => verifies) }, wsHandler: { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() } }
    }

    it('upgrades a request with a valid Bearer token + x-hand-id, verified by pairing', async () => {
      const handHub = makeHandHub(true)
      const wsServer = await setupWsServer(makeCtx({ handHub }))
      const server = makeMockServer()

      const res = wsServer.handleHandUpgrade(
        new Request('http://x/api/v1/hand/ws', { headers: { authorization: 'Bearer tok', 'x-hand-id': 'hand-1' } }),
        server,
      )

      expect(res).toBeUndefined()
      expect(handHub.pairing.verifyToken).toHaveBeenCalledWith('hand-1', 'tok')
      expect(server.upgrade).toHaveBeenCalledWith(expect.anything(), { data: { userId: 'hand', isHand: true, handId: 'hand-1' } })
    })

    it('401s when the Authorization header is missing', async () => {
      const wsServer = await setupWsServer(makeCtx({ handHub: makeHandHub(true) }))
      const res = wsServer.handleHandUpgrade(new Request('http://x/api/v1/hand/ws', { headers: { 'x-hand-id': 'hand-1' } }), makeMockServer())
      expect(res?.status).toBe(401)
    })

    it('401s when x-hand-id is missing', async () => {
      const wsServer = await setupWsServer(makeCtx({ handHub: makeHandHub(true) }))
      const res = wsServer.handleHandUpgrade(new Request('http://x/api/v1/hand/ws', { headers: { authorization: 'Bearer tok' } }), makeMockServer())
      expect(res?.status).toBe(401)
    })

    it('401s when pairing.verifyToken rejects', async () => {
      const wsServer = await setupWsServer(makeCtx({ handHub: makeHandHub(false) }))
      const res = wsServer.handleHandUpgrade(
        new Request('http://x/api/v1/hand/ws', { headers: { authorization: 'Bearer tok', 'x-hand-id': 'hand-1' } }),
        makeMockServer(),
      )
      expect(res?.status).toBe(401)
    })

    it('401s when handHub is not wired at all (e.g. module disabled)', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const res = wsServer.handleHandUpgrade(
        new Request('http://x/api/v1/hand/ws', { headers: { authorization: 'Bearer tok', 'x-hand-id': 'hand-1' } }),
        makeMockServer(),
      )
      expect(res?.status).toBe(401)
    })
  })

  describe('websocket handlers', () => {
    it('open/message/close route a regular (non-hand) socket through wsRegistry', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const ws = makeMockWs({ userId: 'user-1' })

      wsServer.websocket.open(ws as any)
      expect(wsServer.wsRegistry.getConnections('user-1')).toHaveLength(1)

      wsServer.websocket.message(ws as any, JSON.stringify({ type: 'subscribe', topic: 'system' }))
      wsServer.wsRegistry.broadcast('system', { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)

      wsServer.websocket.close(ws as any)
      expect(wsServer.wsRegistry.getConnections('user-1')).toHaveLength(0)
    })

    it('ignores malformed subscribe messages', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const ws = makeMockWs({ userId: 'user-1' })
      wsServer.websocket.open(ws as any)
      expect(() => wsServer.websocket.message(ws as any, 'not json')).not.toThrow()
    })

    it('routes a hand socket to handHub.wsHandler instead of the registry', async () => {
      const handHub = { wsHandler: { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() } }
      const wsServer = await setupWsServer(makeCtx({ handHub }))
      const ws = makeMockWs({ userId: 'hand', isHand: true, handId: 'hand-1' })

      wsServer.websocket.open(ws as any)
      wsServer.websocket.message(ws as any, 'raw-hand-payload')
      wsServer.websocket.close(ws as any)

      expect(handHub.wsHandler.onOpen).toHaveBeenCalledWith(ws, 'hand-1')
      expect(handHub.wsHandler.onMessage).toHaveBeenCalledWith(ws, 'raw-hand-payload')
      expect(handHub.wsHandler.onClose).toHaveBeenCalledWith(ws, 'hand-1')
      // A hand socket must never land in the plain-user registry.
      expect(wsServer.wsRegistry.getConnections('hand')).toHaveLength(0)
    })

    it('a hand socket is a no-op when handHub is not wired', async () => {
      const wsServer = await setupWsServer(makeCtx())
      const ws = makeMockWs({ userId: 'hand', isHand: true, handId: 'hand-1' })
      expect(() => {
        wsServer.websocket.open(ws as any)
        wsServer.websocket.message(ws as any, 'x')
        wsServer.websocket.close(ws as any)
      }).not.toThrow()
    })
  })

  describe('D14 — ACL wiring', () => {
    it('wires ctx.wsAcl into the registry so a denied subscribe NACKs', async () => {
      const wsAcl = createTopicAcl()
      wsAcl.setRoleLookup(() => 'user')
      const wsServer = await setupWsServer(makeCtx({ wsAcl }))
      const ws = makeMockWs({ userId: 'user-1' })
      wsServer.websocket.open(ws as any)

      wsServer.websocket.message(ws as any, JSON.stringify({ type: 'subscribe', topic: 'notifications:someone-else' }))

      expect(JSON.parse(ws.send.mock.calls[0][0]).event).toBe('subscribe_denied')
    })

    it('warns but does not throw when ctx.wsAcl is absent (unrestricted subscribe)', async () => {
      const ctx = makeCtx()
      const wsServer = await setupWsServer(ctx)
      expect(ctx.logger.warn).toHaveBeenCalled()
      const ws = makeMockWs({ userId: 'user-1' })
      wsServer.websocket.open(ws as any)
      expect(() => wsServer.websocket.message(ws as any, JSON.stringify({ type: 'subscribe', topic: 'anything' }))).not.toThrow()
    })
  })

  describe('boot recovery is OFF the listen path (F2 T8 / C1)', () => {
    // C1 — setupWsServer is awaited by BOTH entrypoints BEFORE Bun.serve, so it
    // must not touch agentPostBoot: a warm-resume awaits a full model run per
    // orphan and would hold the port closed. Recovery moved to the
    // fire-and-forget startAgentPostBoot, invoked AFTER the listen.
    it('setupWsServer never invokes agentPostBoot — the listen path stays unblocked', async () => {
      const agentPostBoot = vi.fn(async () => {})
      await setupWsServer(makeCtx({ agentPostBoot }))
      expect(agentPostBoot).not.toHaveBeenCalled()
    })

    it('startAgentPostBoot invokes recovery fire-and-forget — it never awaits the resume', () => {
      // A recovery that never settles must NOT hang the caller: if
      // startAgentPostBoot awaited it, this synchronous test would never return.
      const agentPostBoot = vi.fn(() => new Promise<void>(() => { /* never resolves */ }))
      const ctx = makeCtx({ agentPostBoot })
      startAgentPostBoot(ctx)
      expect(agentPostBoot).toHaveBeenCalledTimes(1)
    })

    it('startAgentPostBoot swallows a rejected recovery (logs, never throws)', async () => {
      const agentPostBoot = vi.fn(async () => { throw new Error('boom') })
      const ctx = makeCtx({ agentPostBoot })
      expect(() => startAgentPostBoot(ctx)).not.toThrow()
      await vi.waitFor(() => expect(ctx.logger.warn).toHaveBeenCalled())
    })

    it('startAgentPostBoot is a no-op when ctx.agentPostBoot is absent', () => {
      expect(() => startAgentPostBoot(makeCtx())).not.toThrow()
    })
  })

  describe('destroy()', () => {
    it('tears down the bus subscriptions the WS bridge registered', async () => {
      const unsubscribe = vi.fn()
      const bus = { on: vi.fn(() => ({ subject: 'x', id: '1', unsubscribe })), emit: vi.fn(), off: vi.fn() }
      const wsServer = await setupWsServer(makeCtx({ bus }))
      wsServer.destroy()
      expect(unsubscribe).toHaveBeenCalled()
    })
  })
})
