// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { HandRegistry } from './hand-registry.js'
import type { HandPairing } from './hand-pairing.js'
import type { HandCapabilities } from './types.js'

interface WsHandlerOptions {
  registry: HandRegistry
  pairing: HandPairing
  logger: Logger
}

export function createHandWsHandler({ registry, pairing, logger }: WsHandlerOptions) {
  const wsToHandId = new Map<any, string>()
  // Hands that presented a valid pairing token on this socket. Only these are
  // allowed to register/route — the upgrade-time handId alone is unauthenticated.
  const authenticatedWs = new Set<any>()

  function onOpen(ws: any, handId?: string): void {
    if (handId) {
      wsToHandId.set(ws, handId)
    }
    logger.debug({ handId }, 'Hand WebSocket connection opened')
    // Send connected confirmation — the Hand client expects this before sending capabilities
    ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'hand:connected', payload: {}, timestamp: Date.now(), protocol: '1.0' }))
  }

  function onMessage(ws: any, raw: string | Buffer): void {
    let msg: any
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
    } catch {
      logger.warn('Hand WS: invalid JSON message')
      return
    }

    switch (msg.type) {
      case 'hand:capabilities':
      case 'hand:hello': {
        const caps = msg.payload as HandCapabilities
        const handId = caps?.handId

        // Fail-closed authentication: the Hand must present the pairing token it
        // received from POST /api/v1/hands/pair, and it must match the persisted
        // token for this handId. The upgrade-time handId (main.ts) is attacker-
        // controlled, so without this any client could register/impersonate a
        // Hand and receive agent tool-execution commands.
        const token = (msg.payload as { token?: unknown })?.token ?? msg.token

        // Prevent registering under a different handId than the one the socket
        // was opened with (declared at the WS upgrade).
        const boundHandId = wsToHandId.get(ws)
        if (!handId || (boundHandId && boundHandId !== handId)) {
          logger.warn({ handId, boundHandId }, 'Hand WS: handId mismatch — rejecting registration')
          ws.send(JSON.stringify({ type: 'hub:error', error: 'handId mismatch' }))
          try { ws.close(1008, 'handId mismatch') } catch {}
          return
        }

        if (!pairing.verifyToken(handId, token)) {
          logger.warn({ handId }, 'Hand WS: invalid or missing pairing token — rejecting registration')
          ws.send(JSON.stringify({ type: 'hub:error', error: 'invalid pairing token' }))
          try { ws.close(1008, 'invalid pairing token') } catch {}
          return
        }

        registry.register(handId, caps, ws)
        wsToHandId.set(ws, handId)
        authenticatedWs.add(ws)
        logger.info({ handId }, 'Hand connected via WS')
        ws.send(JSON.stringify({ type: 'hub:welcome', handId }))
        break
      }

      case 'hand:ping': {
        const handId = wsToHandId.get(ws)
        if (handId && authenticatedWs.has(ws)) registry.updateLastSeen(handId)
        ws.send(JSON.stringify({ type: 'hub:pong' }))
        break
      }

      case 'hand:result': {
        const handId = wsToHandId.get(ws)
        if (handId && authenticatedWs.has(ws)) registry.updateLastSeen(handId)
        break
      }

      default:
        logger.debug({ type: msg.type }, 'Hand WS: unknown message type')
    }
  }

  function onClose(ws: any, _handId?: string): void {
    const handId = wsToHandId.get(ws)
    // Only unregister if THIS socket is the authenticated owner currently
    // registered for the handId. An unauthenticated socket that declared the
    // same handId at upgrade must never evict a legitimately connected Hand.
    if (handId && authenticatedWs.has(ws) && registry.getWs(handId) === ws) {
      registry.unregister(handId)
      logger.info({ handId }, 'Hand disconnected')
    }
    wsToHandId.delete(ws)
    authenticatedWs.delete(ws)
  }

  return { onOpen, onMessage, onClose }
}
