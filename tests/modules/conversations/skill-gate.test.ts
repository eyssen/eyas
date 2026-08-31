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
