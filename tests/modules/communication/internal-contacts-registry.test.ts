// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createInternalContactsRegistry, type InternalContactsRegistry } from '../../../src/modules/communication/internal-contacts-registry.js'

function setupDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  // Create the table inline (matches internal-contacts-schema.ts)
  db.run(sql`CREATE TABLE internal_contacts (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'internal',
    notes TEXT,
    added_at TEXT NOT NULL,
    added_by TEXT NOT NULL
  )`)
  db.run(sql`CREATE UNIQUE INDEX internal_contacts_ident_channel ON internal_contacts(identifier, channel_type)`)
  return db
}

describe('InternalContactsRegistry', () => {
  let registry: InternalContactsRegistry
  let db: ReturnType<typeof setupDb>

  beforeEach(() => {
    db = setupDb()
    registry = createInternalContactsRegistry(db as never)
  })

  it('add creates row and lookup finds it', async () => {
    const created = await registry.add({
      identifier: 'alice@example.com',
      channelType: 'email',
      displayName: 'Krisztian',
      role: 'owner',
      addedBy: 'system',
    })
    const found = await registry.lookup('alice@example.com', 'email')
    expect(found?.id).toBe(created.id)
    expect(found?.displayName).toBe('Krisztian')
  })

  it('add enforces unique (identifier, channelType)', async () => {
    await registry.add({ identifier: 'a@b.com', channelType: 'email', displayName: 'A', role: 'owner', addedBy: 'sys' })
    await expect(registry.add({ identifier: 'a@b.com', channelType: 'email', displayName: 'Dup', role: 'owner', addedBy: 'sys' })).rejects.toThrow()
  })

  it('remove deletes the contact', async () => {
    const c = await registry.add({ identifier: 'x@y.com', channelType: 'email', displayName: 'X', role: 'team-member', addedBy: 'sys' })
    expect(await registry.remove(c.id)).toBe(true)
    expect(await registry.lookup('x@y.com', 'email')).toBeNull()
    expect(await registry.remove(c.id)).toBe(false)
  })

  it('isInternal returns true for known and false for unknown', async () => {
    await registry.add({ identifier: 'tg-12345', channelType: 'telegram', displayName: 'T', role: 'team-member', addedBy: 'sys' })
    expect(await registry.isInternal('tg-12345', 'telegram')).toBe(true)
    expect(await registry.isInternal('tg-99999', 'telegram')).toBe(false)
    // Same identifier on a different channel type is also unknown
    expect(await registry.isInternal('tg-12345', 'email')).toBe(false)
  })

  it('list returns all contacts in insertion (added_at) order', async () => {
    await registry.add({ identifier: 'a', channelType: 'web', displayName: 'A', role: 'owner', addedBy: 'sys' })
    await new Promise((r) => setTimeout(r, 5)) // ensure distinct addedAt timestamps
    await registry.add({ identifier: 'b', channelType: 'web', displayName: 'B', role: 'team-member', addedBy: 'sys' })
    const all = await registry.list()
    expect(all.map((c) => c.identifier)).toEqual(['a', 'b'])
  })
})
