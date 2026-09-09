import { describe, it, expect } from 'vitest'
import { HandRegistry } from '@modules/hand-hub/hand-registry'
import { HandPairing } from '@modules/hand-hub/hand-pairing'
import { HandRouter } from '@modules/hand-hub/hand-router'
import { createHandWsHandler } from '@modules/hand-hub/hand-ws-handler'
import { createHandHubTables } from '@modules/hand-hub/schema'
import type { HandCapabilities } from '@modules/hand-hub/types'
import { createMemoryDb } from '../../helpers/test-db'
import pino from 'pino'

const makeCapabilities = (handId: string, toolIds: string[] = []): HandCapabilities => ({
  handId,
  name: `Hand-${handId}`,
  platform: 'darwin',
  arch: 'arm64',
  osVersion: '15.0',
  protocolVersion: '1.0.0',
  capabilities: { cli: true, osAutomation: false, computerUse: false },
  discoveredTools: toolIds.map(id => ({ id, name: id, type: 'cli', path: `/usr/bin/${id}`, capabilities: [] })),
})

describe('HandRegistry', () => {
  it('registers and retrieves a hand', () => {
    const registry = new HandRegistry()
    const caps = makeCapabilities('hand-1')
    registry.register('hand-1', caps)
    const hand = registry.getHand('hand-1')
    expect(hand).toBeDefined()
    expect(hand?.handId).toBe('hand-1')
    expect(hand?.name).toBe('Hand-hand-1')
  })

  it('removes a hand', () => {
    const registry = new HandRegistry()
    registry.register('hand-2', makeCapabilities('hand-2'))
    registry.unregister('hand-2')
    expect(registry.getHand('hand-2')).toBeUndefined()
    expect(registry.listHands()).toHaveLength(0)
  })
})

describe('HandPairing', () => {
  it('generates a 6-digit code', () => {
    const pairing = new HandPairing()
    const code = pairing.generateCode('user-1')
    expect(code).toMatch(/^\d{6}$/)
  })

  it('validates a correct code', () => {
    const pairing = new HandPairing()
    const code = pairing.generateCode('user-42')
    const result = pairing.validateCode(code, 'hand-abc', 'My Hand', 'darwin')
    expect(result).not.toBeNull()
    expect(result?.handId).toBe('hand-abc')
    expect(result?.userId).toBe('user-42')
    expect(result?.token).toBeTruthy()
  })

  it('rejects an invalid code', () => {
    const pairing = new HandPairing()
    const result = pairing.validateCode('000000', 'hand-x', 'Test', 'linux')
    expect(result).toBeNull()
  })

  it('rejects an expired code', async () => {
    const pairing = new HandPairing(100) // 100ms TTL
    const code = pairing.generateCode('user-exp')
    await new Promise(r => setTimeout(r, 150))
    const result = pairing.validateCode(code, 'hand-y', 'Expired', 'win32')
    expect(result).toBeNull()
  })
})

describe('HandPairing token persistence + verification', () => {
  function setup() {
    const db = createMemoryDb()
    createHandHubTables(db as any)
    const pairing = new HandPairing(5 * 60 * 1000, db as any)
    return { db, pairing }
  }

  it('persists the issued token and verifies it', () => {
    const { pairing } = setup()
    const code = pairing.generateCode('user-1')
    const result = pairing.validateCode(code, 'hand-1', 'My Hand', 'darwin')!
    expect(result).not.toBeNull()
    expect(pairing.verifyToken('hand-1', result.token)).toBe(true)
  })

  it('rejects a wrong token (fail-closed)', () => {
    const { pairing } = setup()
    const code = pairing.generateCode('user-1')
    pairing.validateCode(code, 'hand-1', 'My Hand', 'darwin')
    expect(pairing.verifyToken('hand-1', 'not-the-token')).toBe(false)
    expect(pairing.verifyToken('hand-1', '')).toBe(false)
    expect(pairing.verifyToken('hand-1', undefined)).toBe(false)
  })

  it('rejects an unknown / never-paired hand', () => {
    const { pairing } = setup()
    expect(pairing.verifyToken('ghost', 'anything')).toBe(false)
  })

  it('fails closed when no DB is configured', () => {
    const pairing = new HandPairing()
    const code = pairing.generateCode('user-1')
    const result = pairing.validateCode(code, 'hand-1', 'My Hand', 'darwin')!
    // Token issued but nowhere persisted → cannot be verified.
    expect(pairing.verifyToken('hand-1', result.token)).toBe(false)
  })

  it('rotates the token on re-pairing (hand_id UNIQUE)', () => {
    const { pairing } = setup()
    const t1 = pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')!.token
    const t2 = pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')!.token
    expect(t1).not.toBe(t2)
    expect(pairing.verifyToken('hand-1', t1)).toBe(false)
    expect(pairing.verifyToken('hand-1', t2)).toBe(true)
  })
})

describe('Hand WS handler authentication (fail-closed)', () => {
  const logger = pino({ level: 'silent' })

  function makeWs() {
    const sent: any[] = []
    let closed: { code?: number; reason?: string } | null = null
    return {
      send: (raw: string) => sent.push(JSON.parse(raw)),
      close: (code?: number, reason?: string) => { closed = { code, reason } },
      get sent() { return sent },
      get closed() { return closed },
    }
  }

  const caps = (handId: string, token?: string): any => ({
    type: 'hand:capabilities',
    payload: {
      handId,
      name: `Hand-${handId}`,
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.0',
      protocolVersion: '1.0.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [],
      ...(token !== undefined ? { token } : {}),
    },
  })

  function setup() {
    const db = createMemoryDb()
    createHandHubTables(db as any)
    const registry = new HandRegistry()
    const pairing = new HandPairing(5 * 60 * 1000, db as any)
    const handler = createHandWsHandler({ registry, pairing, logger })
    return { registry, pairing, handler }
  }

  it('rejects registration with no token — no command channel granted', () => {
    const { registry, handler } = setup()
    const ws = makeWs()
    handler.onOpen(ws as any, 'evil')
    handler.onMessage(ws as any, JSON.stringify(caps('evil')))
    expect(registry.getHand('evil')).toBeUndefined()
    expect(registry.listHands()).toHaveLength(0)
    expect(ws.closed).not.toBeNull()
    expect(ws.sent.some(m => m.type === 'hub:welcome')).toBe(false)
  })

  it('rejects registration with an invalid token', () => {
    const { registry, pairing, handler } = setup()
    pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')
    const ws = makeWs()
    handler.onOpen(ws as any, 'hand-1')
    handler.onMessage(ws as any, JSON.stringify(caps('hand-1', 'bogus')))
    expect(registry.getHand('hand-1')).toBeUndefined()
    expect(ws.closed).not.toBeNull()
  })

  it('accepts registration with a valid persisted token', () => {
    const { registry, pairing, handler } = setup()
    const { token } = pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')!
    const ws = makeWs()
    handler.onOpen(ws as any, 'hand-1')
    handler.onMessage(ws as any, JSON.stringify(caps('hand-1', token)))
    expect(registry.getHand('hand-1')).toBeDefined()
    expect(registry.getWs('hand-1')).toBe(ws)
    expect(ws.sent.some(m => m.type === 'hub:welcome')).toBe(true)
    expect(ws.closed).toBeNull()
  })

  it('rejects a handId that differs from the upgrade-time handId', () => {
    const { registry, pairing, handler } = setup()
    const { token } = pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')!
    const ws = makeWs()
    handler.onOpen(ws as any, 'hand-1')
    // Valid token for hand-1 but declares hand-2 → must be rejected.
    handler.onMessage(ws as any, JSON.stringify(caps('hand-2', token)))
    expect(registry.getHand('hand-2')).toBeUndefined()
    expect(ws.closed).not.toBeNull()
  })

  it('an unauthenticated socket sharing a handId cannot evict a live Hand', () => {
    const { registry, pairing, handler } = setup()
    const { token } = pairing.validateCode(pairing.generateCode('u'), 'hand-1', 'H', 'darwin')!
    // Legit hand connects.
    const legit = makeWs()
    handler.onOpen(legit as any, 'hand-1')
    handler.onMessage(legit as any, JSON.stringify(caps('hand-1', token)))
    expect(registry.getWs('hand-1')).toBe(legit)

    // Attacker opens a second socket declaring the same handId, fails auth.
    const attacker = makeWs()
    handler.onOpen(attacker as any, 'hand-1')
    handler.onMessage(attacker as any, JSON.stringify(caps('hand-1', 'bogus')))
    // Attacker socket closes — must NOT unregister the legit hand.
    handler.onClose(attacker as any, 'hand-1')
    expect(registry.getHand('hand-1')).toBeDefined()
    expect(registry.getWs('hand-1')).toBe(legit)
  })
})

describe('HandRouter', () => {
  it('routes to hand with matching tool', () => {
    const registry = new HandRegistry()
    registry.register('hand-tool', makeCapabilities('hand-tool', ['git', 'node']))
    const router = new HandRouter(registry)
    expect(router.findByTool('git')).toBe('hand-tool')
    expect(router.findByTool('python')).toBeNull()
  })

  it('routes to explicit hand', () => {
    const registry = new HandRegistry()
    registry.register('hand-explicit', makeCapabilities('hand-explicit'))
    const router = new HandRouter(registry)
    expect(router.route({ targetHandId: 'hand-explicit' })).toBe('hand-explicit')
    expect(router.route({ targetHandId: 'nonexistent' })).toBeNull()
  })
})
