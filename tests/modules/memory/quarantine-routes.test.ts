// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B10 — the quarantine routes on the HTTP surface. Owner only: `delete` on
// MemoryEntry is held by the owner alone (roles.ts), so admins, users and
// agents get 403 on every route, reads included (the history names providers
// and conversations). Bodies are Zod-validated; every applied or released
// quarantine is audited.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initZstd } from '@shared/zstd'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryRoutes, type MemoryQuarantineHooks } from '@modules/memory/routes'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { seedRawRow } from './v2/extract-helpers'

const logger = { debug: () => {}, info: vi.fn(), warn: () => {}, error: () => {} } as any

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let wikilinks: ReturnType<typeof createWikilinkService>
let hooks: Required<MemoryQuarantineHooks> & { log: ReturnType<typeof vi.fn> }
let replyId: string

beforeAll(async () => { await initZstd() })

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, provider_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, provider_id) VALUES ('conv-grok', 'grok-cli')`)
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-quarantine-routes-'))
  wikilinks = createWikilinkService(db)
  wikilinks.init()
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)
  memory = createMemoryService({
    working: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
    episodic: createEpisodicMemoryService(db),
    archive: createArchiveMemoryService(db),
    vault, indexer, wikilinks, db,
  })
  replyId = seedRawRow(db, { conversationId: 'conv-grok', sourceType: 'assistant_message', trustTier: 'derived', content: 'a grok reply' }).id
  seedRawRow(db, { conversationId: 'conv-grok', sourceType: 'user_message', trustTier: 'owner', content: 'the owner asks' })
  const log = vi.fn()
  hooks = { flushPending: vi.fn(), afterChange: vi.fn(), audit: () => ({ log }), log }
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

/** The real CASL ability for a role, from roles.ts itself (empty registry). */
function mountAs(role: 'owner' | 'admin' | 'user' | 'agent', userId = `${role}-1`): Hono {
  const ability = buildAbilityForRole(role, createPermissionRegistry())
  const a = new Hono()
  a.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
  createMemoryRoutes(a, memory, logger, { db, wikilinks, quarantine: hooks })
  return a
}

const post = (app: Hono, path: string, body?: unknown) => app.request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const tierOf = (id: string) => (db.all(sql`SELECT trust_tier AS t FROM memory_raw WHERE id = ${id}`) as Array<{ t: string }>)[0]!.t

describe('quarantine routes — owner', () => {
  it('lists providers and history, previews, applies (audited) and releases (audited)', async () => {
    const app = mountAs('owner')
    const list = await (await app.request('/api/v1/memory/quarantine')).json() as any
    expect(list).toEqual({ entries: [], providers: [{ provider: 'grok-cli', rows: 1 }] })

    const preview = await post(app, '/api/v1/memory/quarantine/preview', { providers: ['grok-cli'] })
    expect(preview.status).toBe(200)
    expect((await preview.json() as any).counts).toMatchObject({ raw: 1, conversations: 1 })
    expect(hooks.flushPending).toHaveBeenCalled()
    expect(tierOf(replyId)).toBe('derived')

    const applied = await post(app, '/api/v1/memory/quarantine', { providers: ['grok-cli'] })
    expect(applied.status).toBe(201)
    const { id } = await applied.json() as any
    expect(tierOf(replyId)).toBe('quarantined')
    expect(hooks.afterChange).toHaveBeenCalled()
    expect(hooks.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'memory.quarantine.apply', module: 'memory', target: id, userId: 'owner-1', reversible: true,
    }))

    const history = await (await app.request('/api/v1/memory/quarantine')).json() as any
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]).toMatchObject({ id, providers: ['grok-cli'], createdBy: 'owner-1', releasedAt: null })

    // An idempotent re-apply is a 200 with no id and writes no audit entry.
    hooks.log.mockClear()
    const again = await post(app, '/api/v1/memory/quarantine', { providers: ['grok-cli'] })
    expect(again.status).toBe(200)
    expect((await again.json() as any).id).toBeNull()
    expect(hooks.log).not.toHaveBeenCalled()

    const released = await post(app, `/api/v1/memory/quarantine/${id}/release`)
    expect(released.status).toBe(200)
    expect(tierOf(replyId)).toBe('derived')
    expect(hooks.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory.quarantine.release', target: id }))
  })

  it('(−) a second release is 409, an unknown id 404, a malformed id 400', async () => {
    const app = mountAs('owner')
    const { id } = await (await post(app, '/api/v1/memory/quarantine', { providers: ['grok-cli'] })).json() as any
    expect((await post(app, `/api/v1/memory/quarantine/${id}/release`)).status).toBe(200)
    const twice = await post(app, `/api/v1/memory/quarantine/${id}/release`)
    expect(twice.status).toBe(409)
    expect((await twice.json() as any).code).toBe('already_released')
    expect((await post(app, '/api/v1/memory/quarantine/01ZZZZZZZZZZZZZZZZZZZZZZZZ/release')).status).toBe(404)
    expect((await post(app, '/api/v1/memory/quarantine/..%2Fetc/release')).status).toBe(400)
  })

  it('(−) an invalid body is 400 (Zod) and changes nothing', async () => {
    const app = mountAs('owner')
    for (const body of [undefined, {}, { providers: [] }, { providers: ['grok-cli'], from: 10, to: 1 }, { providers: ['grok-cli'], extra: 1 }, { providers: 'grok-cli' }]) {
      const res = await post(app, '/api/v1/memory/quarantine', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await post(app, '/api/v1/memory/quarantine/preview', body)).status).toBe(400)
    }
    expect(tierOf(replyId)).toBe('derived')
    expect(hooks.log).not.toHaveBeenCalled()
  })

  it('a note that cannot be moved is a 500 with its code, and nothing changes', async () => {
    db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id, source) VALUES ('semantic/n.md', 'conversations', 'conv-grok', 'capture')`)
    memory.vault.write('semantic/n.md', { title: 'N', tags: [], tier: 'semantic', links: [], created: '2026-09-10', updated: '2026-09-10' }, 'body')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(vaultPath, '.quarantine'), 'blocked')
    const res = await post(mountAs('owner'), '/api/v1/memory/quarantine', { providers: ['grok-cli'] })
    expect(res.status).toBe(500)
    expect((await res.json() as any).code).toBe('note_move_failed')
    expect(tierOf(replyId)).toBe('derived')
    expect(existsSync(join(vaultPath, 'semantic/n.md'))).toBe(true)
  })
})

describe('quarantine routes — everyone else', () => {
  for (const role of ['admin', 'user', 'agent'] as const) {
    it(`(−) ${role}: 403 on every route, nothing changes`, async () => {
      const app = mountAs(role)
      expect((await app.request('/api/v1/memory/quarantine')).status).toBe(403)
      expect((await post(app, '/api/v1/memory/quarantine/preview', { providers: ['grok-cli'] })).status).toBe(403)
      expect((await post(app, '/api/v1/memory/quarantine', { providers: ['grok-cli'] })).status).toBe(403)
      expect((await post(app, '/api/v1/memory/quarantine/01ZZZZZZZZZZZZZZZZZZZZZZZZ/release')).status).toBe(403)
      expect(tierOf(replyId)).toBe('derived')
      expect(hooks.log).not.toHaveBeenCalled()
    })
  }
})
