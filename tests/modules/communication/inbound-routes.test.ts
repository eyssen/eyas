// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// HTTP surface for the inbound queue. Auth is enforced deny-by-default; these
// routes additionally require the Communication CASL permission (retry is a
// privileged action since it re-runs an agent).

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createInboundTables,
  createInboundCoordinator,
  type InboundMessage,
} from '@modules/communication/inbound-coordinator.js'
import { createInboundRoutes } from '@modules/communication/inbound-routes.js'

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any
const allow = { can: () => true }

function makeMsg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    source: 'telegram',
    providerMessageId: 'm1',
    channelId: 'chat-1',
    senderId: 'user-1',
    content: 'hi',
    receivedAt: '2026-06-23T10:00:00.000Z',
    ...over,
  }
}

function setup(opts: { ability?: { can: () => boolean } } = {}) {
  const db = createMemoryDb()
  createInboundTables(db)
  const coordinator = createInboundCoordinator({
    db,
    logger: noopLogger,
    resolveBinding: () => ({ agentId: null, mode: 'managed' }),
    createConversation: () => 'c1',
    addMessage: () => {},
    runAgent: async () => ({ replyText: null }),
    reply: async () => {},
    now: () => new Date('2026-06-23T10:00:00.000Z'),
  })
  const app = new Hono()
  if (opts.ability) {
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', opts.ability)
      ;(c as any).set('userId', 'op')
      await next()
    })
  }
  createInboundRoutes(app as any, coordinator)
  return { app, coordinator }
}

describe('inbound queue routes', () => {
  it('GET /inbound requires auth (401 without ability)', async () => {
    const res = await setup().app.request('/api/v1/communication/inbound')
    expect(res.status).toBe(401)
  })

  it('lists inbound events', async () => {
    const { app, coordinator } = setup({ ability: allow })
    coordinator.enqueue(makeMsg())
    const res = await app.request('/api/v1/communication/inbound')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { events: Array<{ provider_message_id: string }> }
    expect(body.events).toHaveLength(1)
    expect(body.events[0].provider_message_id).toBe('m1')
  })

  it('GET /inbound/:id returns 404 for an unknown id', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/communication/inbound/9999')
    expect(res.status).toBe(404)
  })

  it('POST /inbound/:id/retry re-queues a known row', async () => {
    const { app, coordinator } = setup({ ability: allow })
    coordinator.enqueue(makeMsg())
    const id = coordinator.list()[0].id
    const res = await app.request(`/api/v1/communication/inbound/${id}/retry`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()) as any).toEqual({ ok: true })
  })

  it('POST /inbound/:id/retry returns 404 for an unknown id', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/communication/inbound/9999/retry', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
