// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-7 / P-19 on the sink that LEAVES THE MACHINE.
//
// Every other consumer of a `contains-secrets` row puts it into a prompt that
// stays with the owner's own model call. The embedding path is different: it
// hands the verbatim body to `ModelGateway.embed()`, i.e. to whichever provider
// the owner configured, and it does so on three triggers the owner never sees —
// the vault-index hook, the episodic hook, and a fire-and-forget backfill on
// every boot. The backfill is the worst of the three: it keys on the stored
// `embedding_hash`, not on how the row was created, so a row the importer
// deliberately created with `embed: false` would be picked up on the next start
// regardless. All three are gated inside the embedding service, so a fourth
// caller cannot slip past.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createEmbeddingService } from '@modules/memory/embeddings/embedding-service'

const EPISODIC_KEY = 'alphabravocharlie0001'
const VAULT_KEY = 'deltaechofoxtrot0002'

let db: ReturnType<typeof createMemoryDb>
let sent: string[]

/** Records every text handed to the provider. The vec store is stubbed: the
 *  gate must close BEFORE `embed()`, so nothing here depends on sqlite-vec. */
function makeService(includeSecrets: boolean | undefined) {
  sent = []
  const bridge = {
    canEmbed: () => true,
    async embed(texts: string[]) { sent.push(...texts); return texts.map(() => [0.1, 0.2, 0.3]) },
    dimensions: () => 3,
  }
  const vecStore = {
    ready: () => true,
    ensureDimension: () => true,
    upsertEpisodic: () => {},
    upsertVault: () => {},
    deleteEpisodic: () => {},
    deleteVault: () => {},
    searchEpisodic: () => [],
    searchVault: () => [],
    stats: () => ({ episodicCount: 0, vaultCount: 0, dimension: 3 }),
  } as any
  return createEmbeddingService({
    db, vecStore, bridge,
    ...(includeSecrets === undefined ? {} : { recall: () => ({ includeSecrets }) }),
  })
}

function seedVaultNote(path: string, tags: string, body: string) {
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
    VALUES (${path}, 'N', 'semantic', ${tags}, ${body}, 'user', 's', 'h', '2026-09-07T00:00:00Z')`)
}

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
})

describe('the episodic hook', () => {
  it('never embeds a flagged row while the gate is closed', async () => {
    const episodic = createEpisodicMemoryService(db)
    const flagged = episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'] })

    expect(await makeService(false).embedAndStoreEpisodic(flagged.id, flagged.content)).toBe(false)
    expect(sent.join('\n')).not.toContain(EPISODIC_KEY)
  })

  it('embeds it once the owner opened memory.recall.includeSecrets', async () => {
    const episodic = createEpisodicMemoryService(db)
    const flagged = episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'] })

    expect(await makeService(true).embedAndStoreEpisodic(flagged.id, flagged.content)).toBe(true)
    expect(sent.join('\n')).toContain(EPISODIC_KEY)
  })

  it('still embeds an ordinary row', async () => {
    const episodic = createEpisodicMemoryService(db)
    const plain = episodic.create({ content: 'zxq ordinary episodic row', sourceType: 'system' })

    expect(await makeService(false).embedAndStoreEpisodic(plain.id, plain.content)).toBe(true)
    expect(sent.join('\n')).toContain('ordinary episodic row')
  })

  it('refuses to embed a row that is not in the database at all', async () => {
    // No tags to clear it with, so there is nothing to decide on.
    expect(await makeService(false).embedAndStoreEpisodic('gone', 'zxq vanished row')).toBe(false)
    expect(sent).toEqual([])
  })
})

describe('the vault-index hook', () => {
  it('never embeds a flagged note while the gate is closed', async () => {
    seedVaultNote('semantic/alpha-key.md', '["contains-secrets"]', `vault body TOKEN=${VAULT_KEY}`)

    expect(await makeService(false).embedAndStoreVault('semantic/alpha-key.md', `vault body TOKEN=${VAULT_KEY}`)).toBe(false)
    expect(sent.join('\n')).not.toContain(VAULT_KEY)
  })

  it('embeds it once the owner opened memory.recall.includeSecrets', async () => {
    seedVaultNote('semantic/alpha-key.md', '["contains-secrets"]', `vault body TOKEN=${VAULT_KEY}`)

    expect(await makeService(true).embedAndStoreVault('semantic/alpha-key.md', `vault body TOKEN=${VAULT_KEY}`)).toBe(true)
    expect(sent.join('\n')).toContain(VAULT_KEY)
  })

  it('still embeds an ordinary note', async () => {
    seedVaultNote('semantic/bravo.md', '[]', 'ordinary vault body')

    expect(await makeService(false).embedAndStoreVault('semantic/bravo.md', 'ordinary vault body')).toBe(true)
    expect(sent.join('\n')).toContain('ordinary vault body')
  })
})

describe('the boot backfill', () => {
  it('skips flagged episodic and vault rows by tag, not by hash', async () => {
    const episodic = createEpisodicMemoryService(db)
    // `embed: false` is exactly what the importer passes; the hook does not
    // fire, and before this gate the next boot embedded the row anyway.
    episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'], embed: false })
    episodic.create({ content: 'zxq ordinary episodic row', sourceType: 'system', embed: false })
    seedVaultNote('semantic/alpha-key.md', '["contains-secrets"]', `vault body TOKEN=${VAULT_KEY}`)
    seedVaultNote('semantic/bravo.md', '[]', 'ordinary vault body')

    const result = await makeService(false).backfill(50)

    const text = sent.join('\n')
    expect(text).not.toContain(EPISODIC_KEY)
    expect(text).not.toContain(VAULT_KEY)
    expect(text).toContain('ordinary episodic row')
    expect(text).toContain('ordinary vault body')
    expect(result).toEqual({ episodic: 1, vault: 1 })
  })

  it('leaves a skipped row with no embedding_hash, so it is never recorded as embedded', async () => {
    const episodic = createEpisodicMemoryService(db)
    const flagged = episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'], embed: false })

    await makeService(false).backfill(50)

    const row = (db.all(sql`SELECT embedding_hash FROM episodic_memories WHERE id = ${flagged.id}`) as Array<{ embedding_hash: string | null }>)[0]
    expect(row.embedding_hash).toBeNull()
  })

  it('embeds them once the owner opened memory.recall.includeSecrets', async () => {
    const episodic = createEpisodicMemoryService(db)
    episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'], embed: false })
    seedVaultNote('semantic/alpha-key.md', '["contains-secrets"]', `vault body TOKEN=${VAULT_KEY}`)

    await makeService(true).backfill(50)

    const text = sent.join('\n')
    expect(text).toContain(EPISODIC_KEY)
    expect(text).toContain(VAULT_KEY)
  })

  it('does not let a page full of flagged rows starve the rows behind them', async () => {
    const episodic = createEpisodicMemoryService(db)
    for (let i = 0; i < 5; i++) {
      episodic.create({ content: `zxq flagged ${i} PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'], embed: false })
    }
    episodic.create({ content: 'zxq ordinary episodic row', sourceType: 'system', embed: false })

    // Budget of 2: filtered in SQL, so the flagged rows never consume it.
    await makeService(false).backfill(2)

    expect(sent.join('\n')).toContain('ordinary episodic row')
  })
})

describe('the service with no recall accessor at all', () => {
  it('fails closed rather than open', async () => {
    const episodic = createEpisodicMemoryService(db)
    const flagged = episodic.create({ content: `zxq episodic PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', tags: ['contains-secrets'] })

    expect(await makeService(undefined).embedAndStoreEpisodic(flagged.id, flagged.content)).toBe(false)
    expect(sent).toEqual([])
  })
})

describe('a malformed tags blob', () => {
  it('is refused by BOTH the hook and the backfill, so the two paths agree', async () => {
    // Broken JSON reads as "no tags" everywhere else in the tree, because there
    // the cost of guessing wrong is a note the owner cannot see. Here it is a
    // body sent to a provider, so this one predicate is strict instead.
    const episodic = createEpisodicMemoryService(db)
    const row = episodic.create({ content: `zxq broken PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', embed: false })
    db.run(sql`UPDATE episodic_memories SET tags = ${'["contains-secrets"'} WHERE id = ${row.id}`)

    expect(await makeService(false).embedAndStoreEpisodic(row.id, row.content)).toBe(false)
    expect(sent).toEqual([])

    await makeService(false).backfill(50)
    expect(sent).toEqual([])
  })

  it('is embedded once the owner opened the gate, like any other row', async () => {
    const episodic = createEpisodicMemoryService(db)
    const row = episodic.create({ content: `zxq broken PGPASSWORD=${EPISODIC_KEY}`, sourceType: 'system', embed: false })
    db.run(sql`UPDATE episodic_memories SET tags = ${'["contains-secrets"'} WHERE id = ${row.id}`)

    expect(await makeService(true).embedAndStoreEpisodic(row.id, row.content)).toBe(true)
    expect(sent.join('\n')).toContain(EPISODIC_KEY)
  })
})

describe('a search query is not stored content', () => {
  it('still embeds the query text itself with the gate closed', async () => {
    // Gating this would break vector search outright, and the caller's own
    // query is not what the importer flagged. What it may RETURN is gated in
    // memory-service.ts instead.
    await makeService(false).searchVault('zxq what did I write about alpha', 5)
    expect(sent.join('\n')).toContain('what did I write about alpha')
  })
})
