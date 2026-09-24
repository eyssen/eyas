// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// W8 — vault notes migrated into L0 before their trust and project were
// stored were all 'owner' and global. The one-shot pass gives their L0 rows
// the note's stored provenance and re-derives their facts and gist.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { extractionScope, runExtraction } from '@modules/memory/v2/extractor'
import { buildVaultDocumentUnit, vaultConversationId } from '@modules/memory/v2/migrate-imported'
import { runVaultReprovenance, VAULT_PROVENANCE_META_KEY } from '@modules/memory/v2/reprovenance'
import { getMemoryMeta } from '@modules/memory/v2/schema'
import { createWikilinkService } from '@shared/wikilinks'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

const config = () => ({ engine: 'v2' as const, extractInLegacy: true })

let db: any
let ingest: MemoryIngest
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  createMemoryTables(db)
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
  root = mkdtempSync(join(tmpdir(), 'eyas-reprov-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A note written to disk and captured into L0 the way the old migration did: owner, global. */
function legacyNote(rel: string, text: string): string {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
  ingest.enqueue(buildVaultDocumentUnit({ relPath: rel, content: text, occurredAtMs: 1_700_000_000_000 }))
  const conv = vaultConversationId(rel)
  ingest.flushConversation(conv, 'manual')
  expect(runExtraction(db, conv, 'manual', { logger: silentLogger, config }).status).not.toBe('failed')
  return conv
}

function indexVault(): void {
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  createVaultIndexer(db, createVaultService(root), wikilinks).indexAll()
}

function liveFacts(conv: string): Array<{ rid: number; trust_tier: string; project: string | null }> {
  return db.all(sql`SELECT f.rid, f.trust_tier,
      (SELECT t.tag_value FROM memory_tag t WHERE t.memory_rid = f.rid AND t.tag_type = 'project') AS project
    FROM memory_fact f
    WHERE f.tombstoned = 0 AND EXISTS (SELECT 1 FROM memory_tag k WHERE k.memory_rid = f.rid AND k.tag_type = 'task' AND k.tag_value = ${conv})`)
}

function rawOf(conv: string): Array<{ rid: number; trust_tier: string; project_id: string | null }> {
  return db.all(sql`SELECT rid, trust_tier, project_id FROM memory_raw WHERE conversation_id = ${conv}`)
}

const PROJECT_NOTE = '---\ntitle: Release train\nkind: project\nproject: p1\n---\nThe release train for this client leaves on Thursdays after the smoke tests.\n'
const AUTO_NOTE = '---\ntitle: Weekly digest\ntags:\n  - auto-consolidated\n---\nThe owner reviews supplier invoices every Monday morning before standup.\n'

describe('runVaultReprovenance', () => {
  it('files a project note\'s L0 row under its project and re-derives its old global facts with the project tag', async () => {
    const conv = legacyNote('projects/notes/release-train.md', PROJECT_NOTE)
    const before = liveFacts(conv)
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((f) => f.project === null && f.trust_tier === 'owner')).toBe(true)
    const oldGist = (db.all(sql`SELECT id FROM memory_gist WHERE scope_id = ${conv} AND is_current = 1`) as any[])[0].id
    indexVault()

    const result = await runVaultReprovenance({ db, logger: silentLogger, config })

    expect(result).toMatchObject({ fixed: 1, failed: 0, skipped: false })
    const raw = rawOf(conv)
    expect(raw).toHaveLength(1)
    expect(raw[0]).toMatchObject({ trust_tier: 'owner', project_id: 'p1' })
    const rawTags = db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${raw[0].rid} AND tag_type IN ('project', 'trust_tier') ORDER BY tag_type`) as any[]
    expect(rawTags).toEqual([{ tag_type: 'project', tag_value: 'p1' }, { tag_type: 'trust_tier', tag_value: 'owner' }])

    // The old facts are tombstoned; the re-derived ones carry the project.
    const tombstoned = db.all(sql`SELECT tombstoned FROM memory_fact WHERE rid IN (${sql.join(before.map((f) => sql`${f.rid}`), sql`, `)})`) as any[]
    expect(tombstoned.every((r: any) => r.tombstoned === 1)).toBe(true)
    const after = liveFacts(conv)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((f) => f.project === 'p1')).toBe(true)
    // One current gist, not the old one.
    const gists = db.all(sql`SELECT id, tombstoned FROM memory_gist WHERE scope_id = ${conv} AND is_current = 1`) as any[]
    expect(gists).toHaveLength(1)
    expect(gists[0].id).not.toBe(oldGist)
    expect((db.all(sql`SELECT tombstoned, is_current FROM memory_gist WHERE id = ${oldGist}`) as any[])[0]).toEqual({ tombstoned: 1, is_current: 0 })
  })

  it('a model-written note loses its owner trust, and so do its facts', async () => {
    const conv = legacyNote('semantic/weekly-digest.md', AUTO_NOTE)
    indexVault()
    await runVaultReprovenance({ db, logger: silentLogger, config })
    expect(rawOf(conv)[0].trust_tier).toBe('derived')
    const facts = liveFacts(conv)
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => f.trust_tier === 'derived')).toBe(true)
  })

  it('a second run is a no-op', async () => {
    const conv = legacyNote('projects/notes/release-train.md', PROJECT_NOTE)
    indexVault()
    await runVaultReprovenance({ db, logger: silentLogger, config })
    expect(getMemoryMeta(db, VAULT_PROVENANCE_META_KEY)).toBe('1')
    const facts = liveFacts(conv).map((f) => f.rid)

    expect(await runVaultReprovenance({ db, logger: silentLogger, config })).toMatchObject({ skipped: true, fixed: 0 })
    // Even without the key, rows that already match are left alone.
    db.run(sql`DELETE FROM memory_meta WHERE key = ${VAULT_PROVENANCE_META_KEY}`)
    expect(await runVaultReprovenance({ db, logger: silentLogger, config })).toMatchObject({ skipped: false, fixed: 0, failed: 0 })
    expect(liveFacts(conv).map((f) => f.rid)).toEqual(facts)
  })

  it('never raises the trust of a row already quarantined', async () => {
    const conv = legacyNote('projects/notes/release-train.md', PROJECT_NOTE)
    db.run(sql`UPDATE memory_raw SET trust_tier = 'quarantined' WHERE conversation_id = ${conv}`)
    indexVault()
    await runVaultReprovenance({ db, logger: silentLogger, config })
    expect(rawOf(conv)[0]).toMatchObject({ trust_tier: 'quarantined', project_id: 'p1' })
  })

  it('a failed re-derivation leaves the note exactly as it was and is retried later', async () => {
    const conv = legacyNote('projects/notes/release-train.md', PROJECT_NOTE)
    indexVault()
    const before = liveFacts(conv)

    const result = await runVaultReprovenance({
      db,
      logger: silentLogger,
      config: () => { throw new Error('config unreadable') },
    })

    expect(result).toMatchObject({ fixed: 0, failed: 1 })
    expect(rawOf(conv)[0]).toMatchObject({ trust_tier: 'owner', project_id: null })
    expect(liveFacts(conv)).toEqual(before)
    expect(getMemoryMeta(db, VAULT_PROVENANCE_META_KEY)).toBeNull()
  })
})

describe('extractionScope', () => {
  it('a source without a conversations row takes the scope of its newest L0 row', () => {
    ingest.enqueue(buildVaultDocumentUnit({ relPath: 'semantic/v.md', content: 'old version of the note', occurredAtMs: 1_000, projectId: null }))
    ingest.enqueue(buildVaultDocumentUnit({ relPath: 'semantic/v.md', content: 'new version of the note', occurredAtMs: 2_000, projectId: 'p9', projectTypeId: 't9' }))
    ingest.flushConversation(vaultConversationId('semantic/v.md'), 'manual')
    expect(extractionScope(db, vaultConversationId('semantic/v.md'))).toEqual({ projectId: 'p9', projectTypeId: 't9' })
    expect(extractionScope(db, 'vault:unknown.md')).toEqual({ projectId: null, projectTypeId: null })
  })

  it('a real conversation keeps its own scope, whatever its rows say', () => {
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER, parent_conversation_id TEXT)`)
    db.run(sql`INSERT INTO conversations (id, project_id) VALUES ('conv-real', NULL)`)
    ingest.enqueue({ ...buildVaultDocumentUnit({ relPath: 'x.md', content: 'text', occurredAtMs: 1, projectId: 'p9' }), conversationId: 'conv-real' })
    ingest.flushConversation('conv-real', 'manual')
    expect(extractionScope(db, 'conv-real')).toEqual({ projectId: null, projectTypeId: null })
  })
})
