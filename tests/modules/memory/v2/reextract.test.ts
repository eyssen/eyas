// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createMemoryTables } from '@modules/memory/schema'
import { migrateImportedIntoL0, vaultConversationId } from '@modules/memory/v2/migrate-imported'
import { reextractMissingImportedFacts } from '@modules/memory/v2/reextract'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

let db: any
let ingest: MemoryIngest

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  createMemoryTables(db)
  ingest = createMemoryIngest({
    db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger,
  })
})

describe('reextractMissingImportedFacts', () => {
  it('rebuilds facts for an imported note that was extracted before states-facts existed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reex-'))
    try {
      mkdirSync(join(root, 'procedural'), { recursive: true })
      writeFileSync(
        join(root, 'procedural', 'feedback_never_commit.md'),
        '---\nkind: feedback\n---\nNever commit or push automatically. Always wait for an explicit request.\n',
      )
      const vault = createVaultService(root)
      await migrateImportedIntoL0({ db, ingest, vault, logger: silentLogger })
      const conv = vaultConversationId('procedural/feedback_never_commit.md')
      // Simulate a pre-fix extraction: gist exists, facts table empty, watermark set.
      db.run(sql`DELETE FROM memory_fact`)
      db.run(sql`DELETE FROM memory_fact_source`)
      const out = await reextractMissingImportedFacts({
        db,
        logger: silentLogger,
        config: () => ({ engine: 'legacy', extractInLegacy: true }),
      })
      expect(out.conversations).toBeGreaterThan(0)
      expect(out.ok + out.failed).toBeGreaterThan(0)
      const facts = db.all(sql`SELECT object_text FROM memory_fact WHERE tombstoned = 0`) as Array<{ object_text: string }>
      expect(facts.some((f) => f.object_text.toLowerCase().includes('commit'))).toBe(true)
      expect(conv.startsWith('vault:')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
