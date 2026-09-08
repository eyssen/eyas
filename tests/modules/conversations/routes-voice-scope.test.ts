// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'

const testDb = createTestDb('voice-scope-routes')

function makePermissions() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: {
      admin: ['read', 'update', 'create', 'delete'],
      owner: ['read', 'update', 'create', 'delete'],
      user: ['read', 'update', 'create', 'delete'],
      agent: [],
      guest: ['read'],
    },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: {
      admin: ['read', 'create'],
      owner: ['read', 'create'],
      user: ['read', 'create'],
      agent: [],
      guest: [],
    },
  })
  return buildAbilityForRole('owner', reg)
}

describe('PUT /api/v1/conversations/:id/voice-scope', () => {
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

    // Create a conversation to test against
    const conv = chatService.create({ userId, title: 'Test Conversation' })
    conversationId = conv.id

    const ability = makePermissions()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    createConversationRoutes(app as any, chatService, gateway, configService)
  })

  it('sets voice scope to internal', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/voice-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'internal' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)

    // Verify DB was updated
    const rows = (db as any).all(
      sql`SELECT voice_scope_override FROM conversations WHERE id = ${conversationId}`,
    ) as any[]
    expect(rows[0].voice_scope_override).toBe('internal')
  })

  it('sets voice scope to external', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/voice-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'external' }),
    })
    expect(res.status).toBe(200)
    const rows = (db as any).all(
      sql`SELECT voice_scope_override FROM conversations WHERE id = ${conversationId}`,
    ) as any[]
    expect(rows[0].voice_scope_override).toBe('external')
  })

  it('clears voice scope when null is passed', async () => {
    // First set it
    db.run(sql`UPDATE conversations SET voice_scope_override = 'internal' WHERE id = ${conversationId}`)
    const res = await app.request(`/api/v1/conversations/${conversationId}/voice-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)

    const rows = (db as any).all(
      sql`SELECT voice_scope_override FROM conversations WHERE id = ${conversationId}`,
    ) as any[]
    expect(rows[0].voice_scope_override).toBeNull()
  })

  it('returns 400 for invalid scope value', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/voice-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'bogus' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown conversation', async () => {
    const res = await app.request('/api/v1/conversations/does-not-exist/voice-scope', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'internal' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for conversation belonging to different user', async () => {
    const gateway = createModelGateway()
    const configService = createProviderConfigService(db)
    const chatService = createConversationService(db)
    const ability = makePermissions()

    // Create conversation owned by different user
    const otherId = await insertTestOwner(db, `other-${Date.now()}`)
    const otherConv = chatService.create({ userId: otherId, title: 'Other' })

    const otherApp = new Hono()
    otherApp.onError(errorHandler)
    otherApp.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId) // userId ≠ otherConv.userId
      await next()
    })
    createConversationRoutes(otherApp as any, chatService, gateway, configService)

    const res = await otherApp.request(`/api/v1/conversations/${otherConv.id}/voice-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'internal' }),
    })
    expect(res.status).toBe(404)
  })
})
