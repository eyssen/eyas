// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A skill must be accepted before it reaches the model. The bug this closes:
// `google-drive-integration` matched "make an HTML page showing the time" at
// 0.9 and was injected silently — nothing in the UI ever said so.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createSkillDecisionStore,
  ensureSkillDecisionSchema,
  resolveSkillForTurn,
  type SkillDecisionStore,
} from '@modules/conversations/skill-gate'

const match = { skillId: 'google-drive-integration', name: 'Google Drive', score: 0.9, matchedPattern: 'name: Google Drive' }

describe('resolveSkillForTurn', () => {
  it('does nothing when nothing matched', () => {
    expect(resolveSkillForTurn({ match: null, decision: null })).toEqual({ action: 'skip', reason: 'no-match' })
  })

  it('proposes a match nobody has ruled on', () => {
    expect(resolveSkillForTurn({ match, decision: null })).toEqual({ action: 'propose', match })
  })

  it('applies a skill that was accepted', () => {
    expect(resolveSkillForTurn({ match, decision: 'accepted' })).toEqual({ action: 'apply', match })
  })

  it('skips a skill that was declined, without asking again', () => {
    expect(resolveSkillForTurn({ match, decision: 'declined' })).toEqual({ action: 'skip', reason: 'declined' })
  })

  it('never proposes where no one can answer', () => {
    // The background path has no human. It may use what was already accepted
    // and must otherwise run without a skill — never stall waiting for a click.
    expect(resolveSkillForTurn({ match, decision: null, canAsk: false })).toEqual({ action: 'skip', reason: 'unattended' })
    expect(resolveSkillForTurn({ match, decision: 'accepted', canAsk: false })).toEqual({ action: 'apply', match })
  })
})

describe('the decision store', () => {
  let db: any
  let store: SkillDecisionStore

  beforeEach(() => {
    db = createMemoryDb()
    ensureSkillDecisionSchema(db)
    store = createSkillDecisionStore(db)
  })

  it('has no opinion until one is recorded', () => {
    expect(store.get('c1', 'google-drive-integration')).toBeNull()
  })

  it('remembers an acceptance and a refusal separately', () => {
    store.set('c1', 'google-drive-integration', 'declined')
    store.set('c1', 'odoo-module', 'accepted')
    expect(store.get('c1', 'google-drive-integration')).toBe('declined')
    expect(store.get('c1', 'odoo-module')).toBe('accepted')
  })

  it('is scoped to one conversation — a skill right here is not right everywhere', () => {
    store.set('c1', 'odoo-module', 'accepted')
    expect(store.get('c2', 'odoo-module')).toBeNull()
  })

  it('lets a decision be changed', () => {
    store.set('c1', 'odoo-module', 'accepted')
    store.set('c1', 'odoo-module', 'declined')
    expect(store.get('c1', 'odoo-module')).toBe('declined')
    expect((db.all(sql`SELECT * FROM conversation_skill_decisions`) as any[]).length).toBe(1)
  })

  it('lists what is active on a conversation, so the UI can show it', () => {
    store.set('c1', 'odoo-module', 'accepted')
    store.set('c1', 'google-drive-integration', 'declined')
    expect(store.accepted('c1')).toEqual(['odoo-module'])
  })

  it('survives a missing table rather than taking the turn down', () => {
    db.run(sql`DROP TABLE conversation_skill_decisions`)
    expect(store.get('c1', 'x')).toBeNull()
    expect(store.accepted('c1')).toEqual([])
  })
})

describe('a matched skill that holds a credential', () => {
  // D-7 / P-19: the gate keeps the tag on the summary so the proposal card can
  // say what accepting would put into the prompt. Reaching this point at all
  // means `memory.recall.includeSecrets` is on — the matcher never sees a
  // flagged skill otherwise.
  const flagged = {
    skillId: 'alpha-deploy', name: 'alpha deploy', score: 0.9,
    matchedPattern: 'name: alpha deploy', containsSecrets: true,
  }

  it('keeps the summary intact so the card can render the tag', () => {
    expect(resolveSkillForTurn({ match: flagged, decision: null })).toEqual({ action: 'propose', match: flagged })
    expect(resolveSkillForTurn({ match: flagged, decision: 'accepted' })).toEqual({ action: 'apply', match: flagged })
  })
})

describe('the conversations route never offers the matcher a flagged skill', () => {
  it('filters contains-secrets skills out of the list handed to matcher.match', async () => {
    const { Hono } = await import('hono')
    const { createConversationRoutes } = await import('@modules/conversations/routes')
    const { createConversationService } = await import('@modules/conversations/conversation-service')
    const { createModelGateway } = await import('@modules/model/gateway')
    const { createProviderConfigService } = await import('@modules/model/provider-config-service')
    const { errorHandler } = await import('@core/http/middleware/error-handler')
    const { buildAbilityForRole } = await import('@modules/permissions/roles')
    const { createPermissionRegistry } = await import('@modules/permissions/registry')
    const { createTestDb, insertTestOwner } = await import('../../helpers/test-db')

    const testDb = createTestDb('skill-gate-secrets')
    const idb = testDb.open()
    const userId = await insertTestOwner(idb, `owner-${Date.now()}-${Math.floor(performance.now())}`)

    const gateway = createModelGateway()
    gateway.registerProvider({
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream() {
        yield {
          type: 'done',
          response: {
            id: 'r', provider: 'p1', model: 'm1',
            content: [{ type: 'text', text: 'ok' }],
            stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    } as any)

    const chat = createConversationService(idb)
    const conversationId = chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id

    const flaggedSkill = { id: 'alpha-deploy', name: 'alpha deploy', enabled: true, capabilities: ['contains-secrets'], triggerPatterns: ['alpha'], content: 'PGPASSWORD=alphabravocharlie0001' }
    const plainSkill = { id: 'bravo-deploy', name: 'bravo deploy', enabled: true, capabilities: [], triggerPatterns: ['bravo'], content: 'nothing sensitive' }
    const seen: any[][] = []
    const skills = {
      loader: { list: () => [flaggedSkill, plainSkill] },
      matcher: { match: (_q: string, list: any[]) => { seen.push(list); return [] } },
      recall: () => ({ includeSecrets: false }),
    }

    const reg = createPermissionRegistry()
    reg.registerSubject('Conversation', {
      actions: ['read', 'update', 'create', 'delete'],
      defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
    })
    reg.registerSubject('ConversationMessage', {
      actions: ['read', 'create'],
      defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
    })
    const ability = buildAbilityForRole('owner', reg)

    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chat, gateway, createProviderConfigService(idb),
      undefined, undefined, undefined, undefined, undefined,
      () => skills as any,
    )

    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'alpha please', provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    await res.text()

    expect(seen).toHaveLength(1)
    expect(seen[0].every((s: any) => !(s.capabilities ?? []).includes('contains-secrets'))).toBe(true)
    expect(seen[0].map((s: any) => s.id)).toEqual(['bravo-deploy'])
  })
})
