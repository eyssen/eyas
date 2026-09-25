// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J1 — memory_expand ids: the en: branch (an entity with its current facts,
// inside D1 only) and the ids that open nothing.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { expandMemoryId, ENTITY_FACT_LIMIT } from '@modules/memory/v2/expand'
import { makeD1Db, entityRow, factRow } from './d1-fixtures'

const fromP = { projectId: 'P', projectTypeId: 'T' }

describe('expandMemoryId — en: entities', () => {
  it('returns the entity with its aliases and its D1 facts (own project + global)', () => {
    const { db } = makeD1Db()
    entityRow(db, 'e-1', 'Northwind', 'organization', ['NW', 'Northwind Ltd'])
    factRow(db, 'f-p', 'Northwind', 'invoices monthly', { project: 'P', projectType: 'T', entityId: 'e-1' })
    factRow(db, 'f-g', 'Northwind', 'is a customer', { entityId: 'e-1' })
    factRow(db, 'f-q', 'Northwind', 'has a secret discount', { project: 'Q', projectType: 'T', entityId: 'e-1' })
    const out = expandMemoryId(db, 'en:e-1', fromP)!
    expect(out.source).toBe('entity')
    expect(out.content).toContain('Northwind (organization)')
    expect(out.content).toContain('Also known as: NW, Northwind Ltd')
    expect(out.content).toContain('Northwind states invoices monthly')
    expect(out.content).toContain('Northwind states is a customer')
    expect(out.content).not.toContain('secret discount')
    expect(out.metadata).toMatchObject({ name: 'Northwind', type: 'organization', facts: 2 })
  })

  it('an entity whose facts all belong to another project returns the name only', () => {
    const { db } = makeD1Db()
    entityRow(db, 'e-2', 'Contoso', 'organization')
    factRow(db, 'f-q1', 'Contoso', 'pays late', { project: 'Q', entityId: 'e-2' })
    factRow(db, 'f-q2', 'Contoso', 'wants a rebate', { project: 'Q', entityId: 'e-2' })
    const out = expandMemoryId(db, 'en:e-2', fromP)!
    expect(out.content).toBe('Contoso (organization)')
    expect(out.metadata).toMatchObject({ facts: 0 })
  })

  it('lists at most ENTITY_FACT_LIMIT current facts, skipping closed and quarantined ones', () => {
    const { db } = makeD1Db()
    entityRow(db, 'e-3', 'Fabrikam')
    for (let i = 0; i < ENTITY_FACT_LIMIT + 3; i++) factRow(db, `f-${i}`, 'Fabrikam', `fact number ${i}`, { entityId: 'e-3' })
    factRow(db, 'f-closed', 'Fabrikam', 'closed fact', { entityId: 'e-3' })
    db.run(sql`UPDATE memory_fact SET valid_until = 1 WHERE id = 'f-closed'`)
    factRow(db, 'f-bad', 'Fabrikam', 'quarantined fact', { entityId: 'e-3' })
    db.run(sql`UPDATE memory_fact SET trust_tier = 'quarantined' WHERE id = 'f-bad'`)
    const out = expandMemoryId(db, 'en:e-3', fromP)!
    expect(out.metadata).toMatchObject({ facts: ENTITY_FACT_LIMIT })
    expect(out.content).not.toContain('closed fact')
    expect(out.content).not.toContain('quarantined fact')
  })

  it('an unknown or tombstoned entity returns null', () => {
    const { db } = makeD1Db()
    entityRow(db, 'e-gone', 'Gone Corp')
    db.run(sql`UPDATE memory_entity SET tombstoned = 1 WHERE id = 'e-gone'`)
    expect(expandMemoryId(db, 'en:e-gone', fromP)).toBeNull()
    expect(expandMemoryId(db, 'en:e-never', fromP)).toBeNull()
  })
})

describe('expandMemoryId — ids that open nothing', () => {
  it('returns null for an unknown prefix, a missing colon or an empty id part', () => {
    const { db } = makeD1Db()
    entityRow(db, 'e-1', 'Northwind')
    expect(expandMemoryId(db, 'zz:e-1', fromP)).toBeNull()
    expect(expandMemoryId(db, 'e-1', fromP)).toBeNull()
    expect(expandMemoryId(db, 'en:', fromP)).toBeNull()
    expect(expandMemoryId(db, ':e-1', fromP)).toBeNull()
  })
})
