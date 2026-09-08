// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared WS upgrade/connection wiring for BOTH server entrypoints
 * (src/main.ts and src/cli/commands/serve.ts). The two used to hand-roll
 * near-identical copies of this (registry+bridge creation, JWT verification
 * at upgrade, post-boot agent recovery) — a fix to one could silently miss
 * the other. This is now the single place that owns:
 *
 *  - resolving the /ws JWT secret (config → secrets vault, same chain the
 *    auth module signs with)
 *  - creating the WSConnectionRegistry + wiring the D14 topic ACL into it
 *    (ctx.wsAcl, created early in bootstrap.ts so modules could register
 *    their resolvers/role-lookup during their own onRegister/onStart)
 *  - the bus→WS bridge
 *  - the regular `/ws?token=<jwt>` upgrade handshake
 *  - the companion-device `/api/v1/hand/ws` upgrade handshake (Bearer +
 *    x-hand-id) — main.ts opts into this via `includeHandHub`; serve.ts
 *    does not expose the endpoint at all today. The open/message/close
 *    socket handlers below are unconditional either way: a socket whose
 *    `isHand` is unset simply never takes the hand-hub branch, so wiring
 *    them identically for both entries is safe even when the endpoint is
 *    absent (ctx.handHub may still be loaded — it just has no way in).
 *
 * Both main.ts and serve.ts stay thin: they own their own static-file
 * serving / API routing and just delegate the two upgrade paths + the
 * `websocket` handlers object to this module.
 */

import { jwtVerify } from 'jose'
import type { Server, ServerWebSocket } from 'bun'
import type { ModuleContext } from '@core/types'
import { createWSConnectionRegistry, type WSConnectionRegistry } from './websocket.js'
import { createWSBridge } from './ws-bridge.js'

export interface WSData {
  userId: string
  isHand?: boolean
  handId?: string
}

export interface WsServer {
  wsRegistry: WSConnectionRegistry
  /** GET /ws?token=<jwt> — the regular (non-hand) client upgrade. */
  handleUpgrade(req: Request, server: Server<WSData>): Promise<Response | undefined>
  /** GET /api/v1/hand/ws — companion device upgrade (Bearer + x-hand-id). */
  handleHandUpgrade(req: Request, server: Server<WSData>): Response | undefined
  /** Drop straight into Bun.serve<WSData>({ ..., websocket }). */
  websocket: {
    open(ws: ServerWebSocket<WSData>): void
    message(ws: ServerWebSocket<WSData>, rawMessage: string | Buffer): void
    close(ws: ServerWebSocket<WSData>): void
  }
  /** Tears down the bus→WS bridge subscriptions — call on SIGINT/SIGTERM. */
  destroy(): void
}

/**
 * Mirrors the auth module's JWT secret resolution chain (config → secrets
 * vault) so /ws upgrade verification uses the same key it signs with.
 * Exported for direct unit testing; callers just need `setupWsServer`.
 */
export async function resolveWsJwtSecret(ctx: ModuleContext): Promise<Uint8Array | null> {
  let raw = ctx.config.auth.jwtSecret
  if (!raw) {
    raw = (await ctx.secrets.get('jwt-secret', 'system')) ?? undefined
  }
  return raw ? new TextEncoder().encode(raw) : null
}

export async function setupWsServer(ctx: ModuleContext): Promise<WsServer> {
  const wsRegistry = createWSConnectionRegistry()
  // D14 — wire the shared topic ACL (bootstrap.ts creates it BEFORE any
  // module's onRegister/onStart runs, specifically so this is never absent
  // by the time modules have registered their resolvers/role lookup into it).
  if ((ctx as any).wsAcl) {
    wsRegistry.setTopicAcl((ctx as any).wsAcl)
  } else {
    ctx.logger.warn('WS topic ACL not found on ctx — subscriptions will be unrestricted')
  }

  // Make the registry available to modules (agent's wsBroadcast, auth's
  // closeUserSockets, etc. all resolve this lazily via (ctx as any).wsRegistry
  // since it does not exist until this point — well after every module's own
  // onRegister/onStart has already run).
  ;(ctx as any).wsRegistry = wsRegistry

  const wsBridge = createWSBridge(ctx.bus, wsRegistry)

  const jwtSecret = await resolveWsJwtSecret(ctx)
  if (!jwtSecret) {
    ctx.logger.warn('JWT secret not available for /ws upgrade — WebSocket auth will fail')
  }

  async function handleUpgrade(req: Request, server: Server<WSData>): Promise<Response | undefined> {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token || !jwtSecret) {
      return new Response('Unauthorized', { status: 401 })
    }
    try {
      const result = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
      const userId = result.payload.sub!
      const upgraded = server.upgrade(req, { data: { userId } })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined
    } catch {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  function handleHandUpgrade(req: Request, server: Server<WSData>): Response | undefined {
    const authHeader = req.headers.get('authorization')
    const handId = req.headers.get('x-hand-id')
    if (!authHeader?.startsWith('Bearer ') || !handId) {
      return new Response('Unauthorized', { status: 401 })
    }
    // Verify the pairing token at upgrade time (fail-closed) so an
    // unauthenticated client cannot even open the socket. The hand-hub
    // message handler re-verifies on register — this is defense-in-depth
    // in front of it. verifyToken is fail-closed on unknown handId/token.
    const token = authHeader.slice('Bearer '.length)
    const pairing = (ctx as any).handHub?.pairing
    if (!pairing || !pairing.verifyToken(handId, token)) {
      return new Response('Unauthorized', { status: 401 })
    }
    const upgraded = server.upgrade(req, { data: { userId: 'hand', isHand: true, handId } })
    if (!upgraded) {
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
    return undefined
  }

  return {
    wsRegistry,
    handleUpgrade,
    handleHandUpgrade,
    websocket: {
      open(ws) {
        if (ws.data.isHand) {
          const handHub = (ctx as any).handHub
          if (handHub?.wsHandler) {
            handHub.wsHandler.onOpen(ws, ws.data.handId!)
          }
          return
        }
        wsRegistry.add(ws.data.userId, ws as any)
      },

      message(ws, rawMessage) {
        if (ws.data.isHand) {
          const handHub = (ctx as any).handHub
          if (handHub?.wsHandler) {
            handHub.wsHandler.onMessage(ws, String(rawMessage))
          }
          return
        }
        try {
          const msg = JSON.parse(String(rawMessage))
          if (msg.type === 'subscribe' && typeof msg.topic === 'string') {
            wsRegistry.subscribe(ws.data.userId, ws as any, msg.topic)
          } else if (msg.type === 'unsubscribe' && typeof msg.topic === 'string') {
            wsRegistry.unsubscribe(ws.data.userId, ws as any, msg.topic)
          }
        } catch {
          // Ignore malformed messages
        }
      },

      close(ws) {
        if (ws.data.isHand) {
          const handHub = (ctx as any).handHub
          if (handHub?.wsHandler) {
            handHub.wsHandler.onClose(ws, ws.data.handId!)
          }
          return
        }
        wsRegistry.remove(ws.data.userId, ws as any)
      },
    },

    destroy() {
      wsBridge.destroy()
    },
  }
}

/**
 * F2 T8 — fire-and-forget boot recovery (warm-resume restart-orphaned
 * background runs, release stale 'working' conversations, re-drive team
 * sessions). BOTH entrypoints call this AFTER Bun.serve is already listening,
 * never from setupWsServer (which they await BEFORE the listen). A warm-resume
 * awaits a full multi-turn model run per orphan; awaiting that on the listen
 * path would refuse every HTTP/WS connection until the whole resumed backlog
 * finished — one hung provider call would hold the port closed for its entire
 * timeout. Mirrors the team-revive path's `void driveTeam(...)` shape. The
 * hook is already error-isolated internally; the catch here is defense in
 * depth so a rejection can never surface as an unhandled rejection.
 */
export function startAgentPostBoot(ctx: ModuleContext): void {
  void (ctx as any).agentPostBoot?.().catch((err: unknown) => {
    ctx.logger.warn({ err }, 'Agent boot recovery failed')
  })
}
