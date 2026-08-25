// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 1 remainder — per-channel autonomy mode. A channel binds an agent in one
// of two modes: 'managed' (default — the security gate governs each tool call)
// or 'autonomous' (unattended, gated by the graduated-autonomy ladder).

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createChannelConfigService } from '@modules/communication/channel-config-service'
import { createCommunicationRoutes } from '@modules/communication/routes'

function createTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS channel_configs (
    id TEXT PRIMARY KEY, channel_type TEXT NOT NULL, channel_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, agent_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, config TEXT DEFAULT '{}',
    mode TEXT NOT NULL DEFAULT 'managed',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}

describe('channel-config-service — per-channel mode', () => {
  let db: ReturnType<typeof createMemoryDb>
  let svc: ReturnType<typeof createChannelConfigService>

  beforeEach(() => {
    db = createMemoryDb()
    createTable(db)
    svc = createChannelConfigService(db)
    svc.upsert({ channelType: 'telegram', channelId: 'c1', name: 'C1' })
  })

  it('defaults mode to managed', () => {
    expect(svc.getByChannelId('c1')!.mode).toBe('managed')
  })

  it('updateMode switches a channel to autonomous', () => {
    svc.updateMode('c1', 'autonomous')
    expect(svc.getByChannelId('c1')!.mode).toBe('autonomous')
  })

  it('list() surfaces the mode', () => {
    svc.updateMode('c1', 'autonomous')
    expect(svc.list()[0].mode).toBe('autonomous')
  })

  it('ensureChannel creates a default row only when absent (never clobbers an existing binding)', () => {
    // existing c1 was upserted in beforeEach; give it an agent + autonomous mode
    svc.updateAgent('c1', 'agent-7')
    svc.updateMode('c1', 'autonomous')
    // ensureChannel on the SAME id must NOT reset agent/mode
    svc.ensureChannel({ channelType: 'telegram', channelId: 'c1', name: 'C1' })
    const c1 = svc.getByChannelId('c1')!
    expect(c1.agentId).toBe('agent-7')
    expect(c1.mode).toBe('autonomous')
    // ensureChannel on a NEW id creates a default-managed, unbound row
    svc.ensureChannel({ channelType: 'telegram', channelId: 'c2', name: 'C2' })
    const c2 = svc.getByChannelId('c2')!
    expect(c2.mode).toBe('managed')
    expect(c2.agentId).toBeNull()
  })
})

describe('PATCH /api/v1/channels/:channelId — mode', () => {
  const allow = { can: () => true }
  function mountApp(opts: { ability?: { can: () => boolean } } = {}) {
    const db = createMemoryDb()
    createTable(db)
    const svc = createChannelConfigService(db)
    svc.upsert({ channelType: 'telegram', channelId: 'c1', name: 'C1' })
    const app = new Hono()
    if (opts.ability) {
      app.use('*', async (c, next) => { (c as any).set('ability', opts.ability); (c as any).set('userId', 'op'); await next() })
    }
    const router = { listChannels: () => [] } as any
    createCommunicationRoutes(app as any, router, undefined, svc)
    return { app, svc }
  }

  it('sets a channel to autonomous mode', async () => {
    const { app, svc } = mountApp({ ability: allow })
    const res = await app.request('/api/v1/channels/c1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'autonomous' }),
    })
    expect(res.status).toBe(200)
    expect(svc.getByChannelId('c1')!.mode).toBe('autonomous')
  })

  it('rejects an invalid mode (400)', async () => {
    const { app } = mountApp({ ability: allow })
    const res = await app.request('/api/v1/channels/c1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'rogue' }),
    })
    expect(res.status).toBe(400)
  })

  it('requires the Communication manage permission (401 without ability)', async () => {
    const { app } = mountApp()
    const res = await app.request('/api/v1/channels/c1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'autonomous' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('communication channel read/test routes — deny-by-default authz', () => {
  const allow = { can: () => true }
  const deny = { can: () => false }

  function mountApp(opts: { ability?: { can: (a: string, s: string) => boolean } } = {}) {
    const db = createMemoryDb()
    createTable(db)
    const svc = createChannelConfigService(db)
    svc.upsert({ channelType: 'telegram', channelId: 'c1', name: 'C1' })
    let sent = 0
    const channel = { id: 'c1', type: 'telegram', name: 'C1', connected: true, send: async () => { sent++ } }
    const router = {
      listChannels: () => [channel],
      getChannel: (id: string) => (id === 'c1' ? channel : undefined),
    } as any
    const app = new Hono()
    if (opts.ability) {
      app.use('*', async (c, next) => { (c as any).set('ability', opts.ability); (c as any).set('userId', 'op'); await next() })
    }
    createCommunicationRoutes(app as any, router, undefined, svc)
    return { app, sent: () => sent }
  }

  const readRoutes = [
    ['GET', '/api/v1/communication/channels'],
    ['GET', '/api/v1/communication/channels/c1'],
    ['GET', '/api/v1/channels'],
  ] as const

  for (const [method, path] of readRoutes) {
    it(`${method} ${path} → 401 without ability`, async () => {
      const { app } = mountApp()
      const res = await app.request(path, { method })
      expect(res.status).toBe(401)
    })

    it(`${method} ${path} → 403 when the ability denies read`, async () => {
      const { app } = mountApp({ ability: deny })
      const res = await app.request(path, { method })
      expect(res.status).toBe(403)
    })

    it(`${method} ${path} → 200 with read permission`, async () => {
      const { app } = mountApp({ ability: allow })
      const res = await app.request(path, { method })
      expect(res.status).toBe(200)
    })
  }

  it('POST /channels/:id/test → 401 without ability (no send)', async () => {
    const { app, sent } = mountApp()
    const res = await app.request('/api/v1/communication/channels/c1/test', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(sent()).toBe(0)
  })

  it('POST /channels/:id/test → 403 without manage permission (no send)', async () => {
    const { app, sent } = mountApp({ ability: deny })
    const res = await app.request('/api/v1/communication/channels/c1/test', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(sent()).toBe(0)
  })

  it('POST /channels/:id/test → 200 and sends with manage permission', async () => {
    const { app, sent } = mountApp({ ability: allow })
    const res = await app.request('/api/v1/communication/channels/c1/test', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(sent()).toBe(1)
  })
})
