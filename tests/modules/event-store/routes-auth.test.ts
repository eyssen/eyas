// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Security regression: the event-store HTTP routes expose full agent-session
// event histories (tool inputs/outputs, reconstructed state) and snapshot
// mutation. They MUST require authentication + the AgentEvent CASL permission.
// Previously they were mounted with zero auth — any anonymous caller could read
// or mutate event history by sessionId.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createEventStoreRoutes } from '@modules/event-store/routes.js'

const store = { queryArray: async () => [], latestSeq: async () => 0, countBySession: async () => 0 }
const replay = { replay: async () => ({ state: {} }) }
const snapshots = { createSnapshot: async () => ({ id: 'snap' }), loadLatest: async () => null }
const logger = { error() {}, info() {}, warn() {}, debug() {} }

function mount(ability?: { can: (a: string, s: string) => boolean }) {
  const app = new Hono()
  if (ability) app.use('*', async (c, next) => { (c as any).set('ability', ability); await next() })
  createEventStoreRoutes(app as any, store as any, replay as any, snapshots as any, logger as any)
  return app
}

describe('event-store routes require auth + AgentEvent permission', () => {
  it('returns 401 for an unauthenticated GET (no ability in context)', async () => {
    const res = await mount().request('/api/v1/events/s1')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an unauthenticated POST snapshot', async () => {
    const res = await mount().request('/api/v1/events/s1/snapshot', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the ability denies AgentEvent', async () => {
    const res = await mount({ can: () => false }).request('/api/v1/events/s1')
    expect(res.status).toBe(403)
  })

  it('allows a GET when the ability grants AgentEvent read', async () => {
    const res = await mount({ can: () => true }).request('/api/v1/events/s1')
    expect(res.status).toBe(200)
  })
})
