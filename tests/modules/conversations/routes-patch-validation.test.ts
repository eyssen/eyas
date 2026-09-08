// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D6 (F2 T2): PATCH /api/v1/conversations/:id had NO validation on `status` —
// a client could forge any status string (including runner-owned ones like
// 'waiting_approval') or set totalCostUsd directly. The whitelist below is
// deliberately narrow: only the statuses a HUMAN legitimately drives from the
// UI (idle/waiting/archived). Other UPDATE_FIELD_MAP fields keep passing
// through unvalidated — this is a targeted hardening, not a general schema.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

const testDb = createTestDb('patch-validation-routes')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

describe('PATCH /api/v1/conversations/:id — status whitelist + totalCostUsd strip', () => {
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let conversationId: string
  let userId: string

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}`)
    const gateway = createModelGateway()
    const configService = createProviderConfigService(db)
    const chatService = createConversationService(db)

    const conv = chatService.create({ userId, title: 'Test Conversation' })
    conversationId = conv.id

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    createConversationRoutes(app as any, chatService, gateway, configService)
  })

  async function patch(body: Record<string, unknown>) {
    return app.request(`/api/v1/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it("rejects status:'waiting_approval' with 400 — that status is runner-owned (park()), not client-settable", async () => {
    const res = await patch({ status: 'waiting_approval' })
    expect(res.status).toBe(400)

    const row = (db.all(sql`SELECT status FROM conversations WHERE id = ${conversationId}`) as any[])[0]
    expect(row.status).toBe('idle')
  })

  it("rejects status:'working' with 400 — not in the client whitelist {'idle','waiting','archived'}", async () => {
    const res = await patch({ status: 'working' })
    expect(res.status).toBe(400)
  })

  it("accepts status:'waiting' (200) — in the client whitelist", async () => {
    const res = await patch({ status: 'waiting' })
    expect(res.status).toBe(200)
    const row = (db.all(sql`SELECT status FROM conversations WHERE id = ${conversationId}`) as any[])[0]
    expect(row.status).toBe('waiting')
  })

  it("accepts status:'idle' and status:'archived' (200)", async () => {
    for (const status of ['idle', 'archived']) {
      const res = await patch({ status })
      expect(res.status).toBe(200)
      const row = (db.all(sql`SELECT status FROM conversations WHERE id = ${conversationId}`) as any[])[0]
      expect(row.status).toBe(status)
    }
  })

  it('strips a client-supplied totalCostUsd instead of writing it (silent, like teamSessionId)', async () => {
    const res = await patch({ totalCostUsd: 999 })
    expect(res.status).toBe(200)
    const row = (db.all(sql`SELECT total_cost_usd FROM conversations WHERE id = ${conversationId}`) as any[])[0]
    expect(row.total_cost_usd).toBe(0)
  })

  it('leaves other UPDATE_FIELD_MAP fields passing through unvalidated (e.g. a plain title update)', async () => {
    const res = await patch({ title: 'Renamed', priority: 'urgent' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.title).toBe('Renamed')
    expect(body.priority).toBe('urgent')
  })

  it('a PATCH with no status field at all still succeeds (status is optional in the schema)', async () => {
    const res = await patch({ title: 'No status touched' })
    expect(res.status).toBe(200)
  })
})
