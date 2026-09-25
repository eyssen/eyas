// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createOwnerUserIdResolver } from '@modules/auth/owner-lookup'

function freshDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite) as any
  // Schema mirror: only what owner-lookup needs.
  db.run(sql`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    is_root_owner INTEGER NOT NULL DEFAULT 0
  )`)
  return { db, sqlite }
}

describe('createOwnerUserIdResolver', () => {
  let db: any
  beforeEach(() => {
    db = freshDb().db
  })

  it('returns the root owner user id when present', () => {
    db.run(sql`INSERT INTO users (id, is_root_owner) VALUES ('owner-1', 1)`)
    db.run(sql`INSERT INTO users (id, is_root_owner) VALUES ('member-1', 0)`)
    const resolve = createOwnerUserIdResolver(db)
    expect(resolve()).toBe('owner-1')
  })

  it('throws a clear error when no root owner exists', () => {
    db.run(sql`INSERT INTO users (id, is_root_owner) VALUES ('member-1', 0)`)
    const resolve = createOwnerUserIdResolver(db)
    expect(() => resolve()).toThrow(/Root owner user not found/)
  })

  it('caches the lookup after first hit and does not requery', () => {
    db.run(sql`INSERT INTO users (id, is_root_owner) VALUES ('owner-1', 1)`)
    const resolve = createOwnerUserIdResolver(db)
    expect(resolve()).toBe('owner-1')
    // Delete the row — cached resolver should still return the cached value
    db.run(sql`DELETE FROM users WHERE id = 'owner-1'`)
    expect(resolve()).toBe('owner-1')
  })

  it('does not cache misses — retries until owner appears', () => {
    const resolve = createOwnerUserIdResolver(db)
    expect(() => resolve()).toThrow(/Root owner user not found/)
    db.run(sql`INSERT INTO users (id, is_root_owner) VALUES ('owner-late', 1)`)
    expect(resolve()).toBe('owner-late')
  })
})
