// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createPairingTables, createPairingService } from '@modules/communication/pairing-service.js'
import { createPairingRoutes } from '@modules/communication/pairing-routes.js'

const allow = { can: () => true }

function setup(opts: { ability?: { can: () => boolean } } = {}) {
  const db = createMemoryDb()
  createPairingTables(db)
  const pairing = createPairingService(db, { now: () => new Date('2026-06-23T10:00:00.000Z') })
  const app = new Hono()
  if (opts.ability) {
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', opts.ability)
      ;(c as any).set('userId', 'op')
      await next()
    })
  }
  createPairingRoutes(app as any, pairing)
  return { app, pairing }
}

describe('pairing routes', () => {
  it('GET /pairings requires auth (401 without ability)', async () => {
    const res = await setup().app.request('/api/v1/communication/pairings')
    expect(res.status).toBe(401)
  })

  it('lists pending pairings', async () => {
    const { app, pairing } = setup({ ability: allow })
    pairing.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const res = await app.request('/api/v1/communication/pairings?status=pending')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pairings: Array<{ channel_id: string }> }
    expect(body.pairings).toHaveLength(1)
    expect(body.pairings[0].channel_id).toBe('chat-1')
  })

  it('approves a pairing by id', async () => {
    const { app, pairing } = setup({ ability: allow })
    pairing.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const id = pairing.listPending('telegram')[0].id
    const res = await app.request(`/api/v1/communication/pairings/${id}/approve`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(pairing.isApproved('telegram', 'chat-1')).toBe(true)
  })

  it('rejects a pairing by id', async () => {
    const { app, pairing } = setup({ ability: allow })
    pairing.requestPairing({ source: 'telegram', channelId: 'chat-1', senderName: 'Alice' })
    const id = pairing.listPending('telegram')[0].id
    const res = await app.request(`/api/v1/communication/pairings/${id}/reject`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(pairing.isApproved('telegram', 'chat-1')).toBe(false)
  })

  it('returns 404 approving an unknown id', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/communication/pairings/9999/approve', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
