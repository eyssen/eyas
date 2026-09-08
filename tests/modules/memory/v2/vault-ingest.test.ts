// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { runExtraction } from '@modules/memory/v2/extractor'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createMemoryTables } from '@modules/memory/schema'
import {
  buildVaultDocumentUnit,
  vaultConversationId,
  migrateImportedIntoL0,
} from '@modules/memory/v2/migrate-imported'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

let db: any
let ingest: MemoryIngest
let caps: ReturnType<typeof makeV2Db>['caps']

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  caps = v2.caps
  createMemoryTables(db)
  ingest = createMemoryIngest({
    db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger,
  })
})

describe('buildVaultDocumentUnit', () => {
  it('names the pseudo-conversation after the vault path and uses owner trust', () => {
    const unit = buildVaultDocumentUnit({
      relPath: 'semantic/alpha.md',
      content: '---\nkind: feedback\n---\nNever commit without asking.\n',
      occurredAtMs: 1_700_000_000_000,
    })
    expect(unit.conversationId).toBe(vaultConversationId('semantic/alpha.md'))
    expect(unit.shredPartitionId).toBe('vault:semantic/alpha.md')
    expect(unit.sourceType).toBe('document')
    expect(unit.trustTier).toBe('owner')
    expect(unit.actor).toBe('owner')
    expect(unit.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(buildVaultDocumentUnit({
      relPath: 'semantic/alpha.md',
      content: '---\nkind: feedback\n---\nNever commit without asking.\n',
      occurredAtMs: 1_700_000_000_000,
    }).id).toBe(unit.id)
  })
})

describe('migrateImportedIntoL0', () => {
  it('writes vault notes and episodic rows into L0, then a re-run is a no-op', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-mig-'))
    try {
      mkdirSync(join(root, 'semantic'), { recursive: true })
      writeFileSync(join(root, 'semantic', 'alpha.md'), '---\nkind: user\n---\nSenior developer.\n')
      const vault = createVaultService(root)
      db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, created_at)
        VALUES ('ep-1', 'We decided the Werth 1145 corrective invoice is a data fix.', 'import', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)

      const first = await migrateImportedIntoL0({ db, ingest, vault, logger: silentLogger })
      expect(first.vault).toBe(1)
      expect(first.episodic).toBe(1)
      expect(first.skipped).toBe(0)
      const raw = db.all(sql`SELECT source_type FROM memory_raw ORDER BY source_type`) as Array<{ source_type: string }>
      expect(raw.map((r) => r.source_type)).toEqual(['document', 'legacy_episodic'])

      const again = await migrateImportedIntoL0({ db, ingest, vault, logger: silentLogger })
      expect(again.vault).toBe(0)
      expect(again.episodic).toBe(0)
      expect(again.skipped).toBe(2)
      expect((db.all(sql`SELECT COUNT(*) AS n FROM memory_raw`) as Array<{ n: number }>)[0].n).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extraction of an ingested vault note produces a heuristic gist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-ex-'))
    try {
      mkdirSync(join(root, 'procedural'), { recursive: true })
      writeFileSync(
        join(root, 'procedural', 'feedback_never_commit.md'),
        '---\nkind: feedback\n---\nNever commit or push automatically. Always wait for an explicit request.\n',
      )
      const vault = createVaultService(root)
      await migrateImportedIntoL0({ db, ingest, vault, logger: silentLogger })
      const conv = vaultConversationId('procedural/feedback_never_commit.md')
      const out = runExtraction(db, conv, 'manual', {
        logger: silentLogger,
        config: () => ({ engine: 'legacy', extractInLegacy: true }),
      })
      expect(out.status).toBe('ok')
      const gists = db.all(sql`SELECT text FROM memory_gist WHERE is_current = 1`) as Array<{ text: string }>
      expect(gists.length).toBeGreaterThan(0)
      expect(gists[0].text.toLowerCase()).toContain('commit')
      const facts = db.all(sql`SELECT subject, predicate, object_text FROM memory_fact WHERE tombstoned = 0`) as Array<{
        subject: string; predicate: string; object_text: string
      }>
      expect(facts.some((f) => f.predicate === 'states' && f.object_text.toLowerCase().includes('commit'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
