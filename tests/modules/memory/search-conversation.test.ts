// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let service: ReturnType<typeof createMemoryService>

function tables() {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    user_id TEXT NOT NULL DEFAULT 'u1', project_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
}

function conv(id: string, over: Record<string, unknown> = {}) {
  const now = '2026-08-31T00:00:00Z'
  db.run(sql`INSERT INTO conversations (id, title, status, project_id, created_at, updated_at)
    VALUES (${id}, ${over.title ?? id}, ${over.status ?? 'idle'}, ${over.project_id ?? null}, ${now}, ${now})`)
}

function msg(conversationId: string, role: string, content: string) {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, ${role}, ${content}, '2026-08-31T00:00:00Z')`)
}

beforeEach(() => {
  db = createMemoryDb()
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-search-conv-'))
  tables()
  createMemoryTables(db)
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  const episodic = createEpisodicMemoryService(db)
  const archive = createArchiveMemoryService(db)
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)
  service = createMemoryService({ working, episodic, archive, vault, indexer, wikilinks, db })
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

describe('MemoryService conversation (L0) search', () => {
  it('default search includes a conversation hit', async () => {
    conv('c1', { title: 'IAP outage' })
    msg('c1', 'user', 'Cloudflare blocked IAP')

    const results = await service.search({ query: 'Cloudflare IAP', projectId: null, scope: 'all' })
    const hit = results.find(r => r.source === 'conversation')
    expect(hit).toBeDefined()
    expect(hit!.content).toContain('Cloudflare blocked IAP')
    expect(hit!.metadata).toMatchObject({
      conversationId: 'c1',
      title: 'IAP outage',
      role: 'user',
    })
    expect(hit!.metadata.messageId).toEqual(expect.any(Number))
  })

  it('tier=episodic does not return conversation hits', async () => {
    conv('c1', { title: 'IAP outage' })
    msg('c1', 'user', 'Cloudflare blocked IAP')
    service.episodic.create({ content: 'Cloudflare IAP episodic note', sourceType: 'user' })

    const results = await service.search({ query: 'Cloudflare IAP', tiers: ['episodic'], scope: 'all' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.source !== 'conversation')).toBe(true)
  })

  it('omitted scope returns L0 from a project conversation', async () => {
    conv('c-proj', { project_id: 'proj-a', title: 'Project thread' })
    msg('c-proj', 'user', 'unique-token-hotel on a real project')

    const results = await service.search({ query: 'unique-token-hotel' })
    expect(results.some(r => r.source === 'conversation' && r.metadata.conversationId === 'c-proj')).toBe(true)
  })

  it('scope=current hides another project\'s L0', async () => {
    conv('c-a', { project_id: 'proj-a', title: 'A' })
    conv('c-b', { project_id: 'proj-b', title: 'B' })
    msg('c-a', 'user', 'unique-token-echo on A')
    msg('c-b', 'user', 'unique-token-echo on B')

    const results = await service.search({
      query: 'unique-token-echo', scope: 'current', projectId: 'proj-a',
    })
    const convHits = results.filter(r => r.source === 'conversation')
    expect(convHits.length).toBeGreaterThan(0)
    expect(convHits.every(r => r.metadata.conversationId === 'c-a')).toBe(true)
  })

  it('excludes the current conversation when excludeConversationId is set', async () => {
    conv('c-cur', { title: 'Current' })
    conv('c-other', { title: 'Other' })
    msg('c-cur', 'user', 'unique-token-foxtrot from current')
    msg('c-other', 'user', 'unique-token-foxtrot from other')

    const results = await service.search({
      query: 'unique-token-foxtrot',
      scope: 'all',
      excludeConversationId: 'c-cur',
    })
    const ids = results.filter(r => r.source === 'conversation').map(r => r.metadata.conversationId)
    expect(ids).toContain('c-other')
    expect(ids).not.toContain('c-cur')
  })
})
