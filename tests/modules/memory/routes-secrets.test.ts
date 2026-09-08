// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-7 / P-19 on the HTTP surface.
//
// Two different rules meet here. `GET /memory/search` is the owner's own
// window on their vault, so it may reveal a `contains-secrets` note — but only
// when the request says so explicitly, because the same endpoint backs the
// dashboard the owner leaves open. And `GET /memory/episodic` must stop
// shipping whole bodies: after R11 an imported transcript can be tens of
// megabytes, and a list view has no use for more than a preview.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryRoutes } from '@modules/memory/routes'
import { createEmbeddingService } from '@modules/memory/embeddings/embedding-service'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { VaultFrontmatter } from '@modules/memory/types'

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any

let app: Hono
let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let wikilinks: ReturnType<typeof createWikilinkService>

const fm = (over: Partial<VaultFrontmatter> = {}): VaultFrontmatter => ({
  title: 'Note', tags: [], tier: 'semantic', links: [],
  created: '2026-09-07', updated: '2026-09-07', ...over,
})

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-memroutes-'))

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

  vault.write('semantic/alpha-key.md', fm({ title: 'Alpha key', tags: ['contains-secrets'] }), 'zxq alpha credential body')
  vault.write('semantic/bravo-note.md', fm({ title: 'Bravo note' }), 'zxq bravo ordinary body')
  indexer.indexAll()

  app = mountAs('owner')
})

/**
 * The real CASL ability for a role. The registry is left EMPTY on purpose, so
 * every grant comes from `roles.ts` itself: the point of these cases is that
 * the override's boundary tracks the real permission table, not a stub or a
 * copy of it that would go stale the moment the table changed.
 */
function mountAs(role: 'owner' | 'admin' | 'user' | 'agent'): Hono {
  const ability = buildAbilityForRole(role, createPermissionRegistry())
  const a = new Hono()
  a.use('*', async (c: any, next: any) => { c.set('ability', ability); await next() })
  createMemoryRoutes(a, memory, logger, { db, wikilinks })
  return a
}

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

async function json(path: string, on: Hono = app): Promise<any> {
  const res = await on.request(path)
  expect(res.status).toBe(200)
  return res.json()
}

describe('GET /api/v1/memory/search', () => {
  it('omits a contains-secrets note by default', async () => {
    const body = await json('/api/v1/memory/search?query=zxq')
    const paths = body.results.map((r: any) => r.metadata?.path)
    expect(paths).toContain('semantic/bravo-note.md')
    expect(paths).not.toContain('semantic/alpha-key.md')
  })

  it('returns it on an explicit owner override', async () => {
    const body = await json('/api/v1/memory/search?query=zxq&includeSecrets=true')
    const paths = body.results.map((r: any) => r.metadata?.path)
    expect(paths).toContain('semantic/alpha-key.md')
  })

  // I2 — `read` on MemoryEntry is held by the `user` AND `agent` roles, so it
  // cannot be what guards the override: an agent principal could otherwise ask
  // for the hidden notes by name and walk straight around the tool schema.
  it('refuses the override to an agent-role caller', async () => {
    const res = await mountAs('agent').request('/api/v1/memory/search?query=zxq&includeSecrets=true')
    expect(res.status).toBe(403)
  })

  it('refuses it to a plain user too, and to an admin', async () => {
    expect((await mountAs('user').request('/api/v1/memory/search?query=zxq&includeSecrets=true')).status).toBe(403)
    expect((await mountAs('admin').request('/api/v1/memory/search?query=zxq&includeSecrets=true')).status).toBe(403)
  })

  it('refuses rather than silently downgrading — a caller must not read an incomplete list as complete', async () => {
    const res = await mountAs('agent').request('/api/v1/memory/search?query=zxq&includeSecrets=true')
    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('results')
  })

  it('still serves an ordinary search to an agent-role caller', async () => {
    const body = await json('/api/v1/memory/search?query=zxq', mountAs('agent'))
    const paths = body.results.map((r: any) => r.metadata?.path)
    expect(paths).toContain('semantic/bravo-note.md')
    expect(paths).not.toContain('semantic/alpha-key.md')
  })

  it('treats any other value as no override, not as a truthy string', async () => {
    const body = await json('/api/v1/memory/search?query=zxq&includeSecrets=1')
    const paths = body.results.map((r: any) => r.metadata?.path)
    expect(paths).not.toContain('semantic/alpha-key.md')
  })
})

describe('GET /api/v1/memory/episodic', () => {
  it('returns a preview and a length instead of the whole body', async () => {
    const long = `${'alpha '.repeat(400)}end`
    memory.episodic.create({ content: long, sourceType: 'system' })

    const items = await json('/api/v1/memory/episodic')
    expect(items).toHaveLength(1)
    expect(items[0].content).toBeUndefined()
    expect(items[0].preview.length).toBeLessThanOrEqual(400)
    expect(items[0].contentLength).toBe(long.length)
  })

  it('collapses whitespace in the preview so a transcript stays one readable line', async () => {
    memory.episodic.create({ content: 'alpha\n\n   bravo\tcharlie', sourceType: 'system' })
    const items = await json('/api/v1/memory/episodic')
    expect(items[0].preview).toBe('alpha bravo charlie')
  })

  it('still returns the full body for one row fetched by id', async () => {
    const row = memory.episodic.create({ content: 'alpha bravo charlie', sourceType: 'system' })
    const item = await json(`/api/v1/memory/episodic/${row.id}`)
    expect(item.content).toBe('alpha bravo charlie')
  })
})

// N3 — `read` on MemoryEntry is held by the `agent` role, so every one of these
// routes is model-reachable in effect. The gate is keyed on the CALLER, not on
// the route: a caller without the owner-only right gets flagged content
// filtered out; the owner sees everything as before.
describe('the other doors to the same content', () => {
  const KEY = 'alphabravocharlie0001'
  let flaggedId: string

  beforeEach(() => {
    memory.vault.write('semantic/charlie-key.md', fm({ title: 'Charlie key', tags: ['contains-secrets'] }), `linked body PGPASSWORD=${KEY} [[Bravo note]]`)
    memory.indexer.indexAll()
    flaggedId = memory.episodic.create({ content: `zxq episodic PGPASSWORD=${KEY}`, sourceType: 'system', tags: ['contains-secrets'] }).id
    memory.episodic.create({ content: 'zxq ordinary episodic row', sourceType: 'system' })
    memory.archive.archive({ originalId: 'o1', content: `zxq archived PGPASSWORD=${KEY}`, sourceType: 'system', tags: ['contains-secrets'], originalCreatedAt: '2026-09-01T00:00:00Z' })
    memory.archive.archive({ originalId: 'o2', content: 'zxq ordinary archived row', sourceType: 'system', tags: [], originalCreatedAt: '2026-09-01T00:00:00Z' })
  })

  it('door 1 — the vault list omits a flagged path for an agent, and keeps it for the owner', async () => {
    expect(await json('/api/v1/memory/vault', mountAs('agent'))).not.toContain('semantic/charlie-key.md')
    expect(await json('/api/v1/memory/vault', mountAs('owner'))).toContain('semantic/charlie-key.md')
  })

  it('door 2 — reading the note by path is 404 for an agent and the body for the owner', async () => {
    expect((await mountAs('agent').request('/api/v1/memory/vault/semantic/charlie-key.md')).status).toBe(404)
    const owned = await json('/api/v1/memory/vault/semantic/charlie-key.md', mountAs('owner'))
    expect(owned.content).toContain(KEY)
  })

  it('door 3 — the episodic list and the by-id fetch both close for an agent', async () => {
    const listed = await json('/api/v1/memory/episodic', mountAs('agent'))
    expect(JSON.stringify(listed)).not.toContain(KEY)
    expect(listed.map((m: any) => m.id)).not.toContain(flaggedId)
    expect((await mountAs('agent').request(`/api/v1/memory/episodic/${flaggedId}`)).status).toBe(404)

    expect((await json('/api/v1/memory/episodic', mountAs('owner'))).map((m: any) => m.id)).toContain(flaggedId)
    expect((await json(`/api/v1/memory/episodic/${flaggedId}`, mountAs('owner'))).content).toContain(KEY)
  })

  it('door 4 — the archive list and by-id fetch close for an agent', async () => {
    const listed = await json('/api/v1/memory/archive', mountAs('agent'))
    expect(JSON.stringify(listed)).not.toContain(KEY)
    const ownerListed = await json('/api/v1/memory/archive', mountAs('owner'))
    expect(JSON.stringify(ownerListed)).toContain(KEY)
    const id = ownerListed.find((m: any) => m.content.includes(KEY)).id
    expect((await mountAs('agent').request(`/api/v1/memory/archive/${id}`)).status).toBe(404)
  })

  it('door 5 — stats leaks neither the body head nor the path (found by the sweep, not the review)', async () => {
    const agentStats = await json('/api/v1/memory/stats', mountAs('agent'))
    expect(JSON.stringify(agentStats.recentEpisodic)).not.toContain(KEY)
    expect(agentStats.tiers.vault.files).not.toContain('semantic/charlie-key.md')
    // Counts stay whole: a total is not content, and shrinking it would lie.
    expect(agentStats.tiers.episodic.valid).toBe(2)

    const ownerStats = await json('/api/v1/memory/stats', mountAs('owner'))
    expect(JSON.stringify(ownerStats.recentEpisodic)).toContain(KEY)
  })

  it('door 6 — a backlink context is an excerpt of the source body, so it closes too', async () => {
    const agentBl = await json('/api/v1/memory/wikilinks/backlinks?target=Bravo%20note', mountAs('agent'))
    expect(JSON.stringify(agentBl)).not.toContain(KEY)
    expect(agentBl.backlinks.every((b: any) => b.sourceId !== 'semantic/charlie-key.md')).toBe(true)

    const ownerBl = await json('/api/v1/memory/wikilinks/backlinks?target=Bravo%20note', mountAs('owner'))
    expect(ownerBl.backlinks.some((b: any) => b.sourceId === 'semantic/charlie-key.md')).toBe(true)
  })

  it('the tag pivot does not hand an agent a directory of exactly what to read', async () => {
    const pivot = await json('/api/v1/memory/tags/contains-secrets', mountAs('agent'))
    expect(pivot.notes).toEqual([])
    expect((await json('/api/v1/memory/tags/contains-secrets', mountAs('owner'))).notes.map((n: any) => n.path))
      .toContain('semantic/charlie-key.md')
  })

  it('the dataview query and the wikilink graph follow the same index rule', async () => {
    const res = await mountAs('agent').request('/api/v1/memory/vault/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).results.map((r: any) => r.path)).not.toContain('semantic/charlie-key.md')

    const graph = await json('/api/v1/memory/wikilinks/graph', mountAs('agent'))
    expect(graph.nodes.map((n: any) => n.id)).not.toContain('semantic/charlie-key.md')
    expect((await json('/api/v1/memory/wikilinks/graph', mountAs('owner'))).nodes.map((n: any) => n.id))
      .toContain('semantic/charlie-key.md')
  })

  // N10 / A-42. The three list compositions ask the DISK what exists
  // (`vault.listFiles()`) and ask the INDEX what is flagged (`vault_index`), so
  // a flagged note written but not yet indexed answered "no row, not flagged"
  // and its path was advertised. The window is the whole gap between an import
  // writing files and the indexer catching up — and `contains-secrets` is a
  // tag one can pivot on, so a path is a pointer to what to go and read.
  it('does not advertise a flagged note that has no index row yet', async () => {
    memory.vault.write('semantic/delta-unindexed.md', fm({ title: 'Delta', tags: ['contains-secrets'] }), `unindexed body PGPASSWORD=${KEY}`)
    // Deliberately NOT indexed: this is the state an import leaves behind.
    expect(await json('/api/v1/memory/vault', mountAs('agent'))).not.toContain('semantic/delta-unindexed.md')
    expect(await json('/api/v1/memory/vault', mountAs('owner'))).toContain('semantic/delta-unindexed.md')

    const agentStats = await json('/api/v1/memory/stats', mountAs('agent'))
    expect(agentStats.tiers.vault.files).not.toContain('semantic/delta-unindexed.md')

    // And the body door was never open, indexed or not.
    expect((await mountAs('agent').request('/api/v1/memory/vault/semantic/delta-unindexed.md')).status).toBe(404)
  })

  /*
   * Door 12. A wiki proposal's `proposedBody` is a whole markdown body derived
   * from the note at `pagePath`, so it is the backlink excerpt again (door 6):
   * the filter belongs on the SOURCE. The producer is a stub in this build
   * (`proposeEditsForClient: () => []`), so the row is seeded straight into the
   * table — which is what makes the guard real rather than vacuous, and what
   * will still be true on the day phase 3F wires a real port.
   */
  describe('door 12 — a wiki proposal derived from a flagged note', () => {
    beforeEach(() => {
      const seed = (id: string, pagePath: string, proposedBody: string): void => {
        db.run(sql`INSERT INTO wiki_edit_proposals
          (id, client_id, page_path, proposed_body, summary, proposed_at, status)
          VALUES (${id}, 'alpha', ${pagePath}, ${proposedBody}, 'refresh', 1760000000, 'pending')`)
      }
      seed('wp-flagged', 'semantic/charlie-key.md', `refreshed body PGPASSWORD=${KEY}`)
      seed('wp-plain', 'semantic/bravo-note.md', 'refreshed ordinary body')
    })

    it('is withheld from an agent, body and id alike, and served whole to the owner', async () => {
      const seen = await json('/api/v1/memory/review/wiki-proposals', mountAs('agent'))
      expect(JSON.stringify(seen)).not.toContain(KEY)
      expect(seen.proposals.map((p: any) => p.id)).not.toContain('wp-flagged')

      const owned = await json('/api/v1/memory/review/wiki-proposals', mountAs('owner'))
      expect(owned.proposals.map((p: any) => p.id)).toContain('wp-flagged')
      expect(JSON.stringify(owned)).toContain(KEY)
    })

    it('still hands the agent a proposal whose source note is not flagged', async () => {
      const seen = await json('/api/v1/memory/review/wiki-proposals', mountAs('agent'))
      expect(seen.proposals.map((p: any) => p.id)).toContain('wp-plain')
    })

    it('withholds it even before the source note has an index row', async () => {
      // The same window A-42 closed for the three list compositions: the file
      // is on disk and flagged, the index has not caught up.
      memory.vault.write('semantic/foxtrot-unindexed.md', fm({ title: 'Foxtrot', tags: ['contains-secrets'] }), `body PGPASSWORD=${KEY}`)
      db.run(sql`INSERT INTO wiki_edit_proposals
        (id, client_id, page_path, proposed_body, summary, proposed_at, status)
        VALUES ('wp-unindexed', 'alpha', 'semantic/foxtrot-unindexed.md', ${`refreshed PGPASSWORD=${KEY}`}, 'refresh', 1760000000, 'pending')`)
      const seen = await json('/api/v1/memory/review/wiki-proposals', mountAs('agent'))
      expect(seen.proposals.map((p: any) => p.id)).not.toContain('wp-unindexed')
    })
  })

  it('leaves an unindexed ORDINARY note reachable, so the fallback is not a blanket denial', async () => {
    memory.vault.write('semantic/echo-unindexed.md', fm({ title: 'Echo' }), 'plain unindexed body')
    expect(await json('/api/v1/memory/vault', mountAs('agent'))).toContain('semantic/echo-unindexed.md')
  })

  it('leaves an ordinary note and row reachable by an agent, so the gate is not a blanket denial', async () => {
    expect(await json('/api/v1/memory/vault', mountAs('agent'))).toContain('semantic/bravo-note.md')
    expect(JSON.stringify(await json('/api/v1/memory/episodic', mountAs('agent')))).toContain('ordinary episodic row')
    expect(JSON.stringify(await json('/api/v1/memory/archive', mountAs('agent')))).toContain('ordinary archived row')
  })
})

// N4 — a different bug class from doors 1-9. Those hand out stored content;
// this one CREATES new content from it. `create` on MemoryEntry is held by the
// `agent` role, `templatePath` accepts any vault note, and the caller's
// frontmatter used to be spread over the inherited tags — so `{"tags": []}`
// wrote an unflagged verbatim copy of a flagged body, which then passed every
// read gate, was returned by search and was embedded by the backfill.
//
// The rule: `contains-secrets` is importer-owned and CALLER-IMMUTABLE.
describe('write paths that derive a note from an existing one', () => {
  const KEY = 'alphabravocharlie0001'

  beforeEach(() => {
    memory.vault.write('templates/charlie-key.md', fm({ title: 'Charlie key', tags: ['contains-secrets'] }), `template body PGPASSWORD=${KEY}`)
    memory.indexer.indexAll()
  })

  async function fromTemplate(role: 'owner' | 'agent', extraFrontmatter?: unknown) {
    return mountAs(role).request('/api/v1/memory/vault/from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templatePath: 'templates/charlie-key.md',
        targetPath: 'semantic/copy.md',
        title: 'Copy',
        ...(extraFrontmatter === undefined ? {} : { extraFrontmatter }),
      }),
    })
  }

  it('an agent cannot strip the flag with caller-supplied frontmatter', async () => {
    expect((await fromTemplate('agent', { tags: [] })).status).toBe(201)
    expect(memory.vault.read('semantic/copy.md')!.frontmatter.tags).toContain('contains-secrets')
  })

  it('nor by naming other tags instead', async () => {
    expect((await fromTemplate('agent', { tags: ['harmless'] })).status).toBe(201)
    const tags = memory.vault.read('semantic/copy.md')!.frontmatter.tags
    expect(tags).toContain('contains-secrets')
    expect(tags).toContain('harmless')
  })

  it('inherits the flag when the caller supplies no frontmatter at all', async () => {
    expect((await fromTemplate('agent')).status).toBe(201)
    expect(memory.vault.read('semantic/copy.md')!.frontmatter.tags).toContain('contains-secrets')
  })

  it('and the derived copy is then gated at every read door, so the leak does not reopen', async () => {
    await fromTemplate('agent', { tags: [] })
    memory.indexer.indexAll()

    expect(await json('/api/v1/memory/vault', mountAs('agent'))).not.toContain('semantic/copy.md')
    expect((await mountAs('agent').request('/api/v1/memory/vault/semantic/copy.md')).status).toBe(404)
    const search = await json('/api/v1/memory/search?query=PGPASSWORD', mountAs('agent'))
    expect(JSON.stringify(search)).not.toContain(KEY)
    expect(await memory.search({ query: 'template body' })).toEqual([])
  })

  it('leaves an unflagged template copying cleanly, so the rule is not a blanket denial', async () => {
    memory.vault.write('templates/plain.md', fm({ title: 'Plain', tags: ['starter'] }), 'plain template body')
    memory.indexer.indexAll()
    const res = await mountAs('agent').request('/api/v1/memory/vault/from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templatePath: 'templates/plain.md', targetPath: 'semantic/plain-copy.md', title: 'Plain copy', extraFrontmatter: { tags: ['mine'] } }),
    })
    expect(res.status).toBe(201)
    expect(memory.vault.read('semantic/plain-copy.md')!.frontmatter.tags).toEqual(['mine'])
  })

  it('an overwrite cannot un-flag a note either', async () => {
    const res = await mountAs('owner').request('/api/v1/memory/vault/templates/charlie-key.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontmatter: { ...fm({ title: 'Charlie key' }), tags: [] }, content: 'rewritten' }),
    })
    expect(res.status).toBe(200)
    expect(memory.vault.read('templates/charlie-key.md')!.frontmatter.tags).toContain('contains-secrets')
  })
})

describe('door 9 — the graph edges', () => {
  const KEY = 'alphabravocharlie0001'

  it('does not carry the flagged source path or its body window back in an edge', async () => {
    memory.vault.write('semantic/charlie-key.md', fm({ title: 'Charlie key', tags: ['contains-secrets'] }), `PGPASSWORD=${KEY} see [[Bravo note]]`)
    memory.indexer.indexAll()

    const graph = await json('/api/v1/memory/wikilinks/graph', mountAs('agent'))
    const serialized = JSON.stringify(graph)
    expect(serialized).not.toContain(KEY)
    expect(serialized).not.toContain('semantic/charlie-key.md')

    const owned = JSON.stringify(await json('/api/v1/memory/wikilinks/graph', mountAs('owner')))
    expect(owned).toContain('semantic/charlie-key.md')
  })
})

// Door 10 — the guard held for six shapes and lost to the seventh. `hasSecretsTag`
// accepts a JSON-STRING encoding of the tag list; `parseVaultFile` accepts only a
// real array and discards everything else as []. So a caller could hand in a
// string that READ as already-flagged, skip the merge, and have the note written
// with a value the reader throws away — a copy holding the credential whose tags
// read back empty. The fix is to ask the question in the shape the store keeps.
describe('door 10 — every shape a caller can put in `tags`', () => {
  const KEY = 'alphabravocharlie0001'

  beforeEach(() => {
    memory.vault.write('templates/charlie-key.md', fm({ title: 'Charlie key', tags: ['contains-secrets'] }), `template body PGPASSWORD=${KEY}`)
    memory.indexer.indexAll()
  })

  async function copyWith(rawBody: string) {
    return mountAs('agent').request('/api/v1/memory/vault/from-template', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rawBody,
    })
  }

  const base = { templatePath: 'templates/charlie-key.md', targetPath: 'semantic/copy.md', title: 'Copy' }

  const shapes: Array<[string, string, 'flagged' | 400]> = [
    ['a JSON-string encoding of the tag list', JSON.stringify({ ...base, extraFrontmatter: { tags: '["contains-secrets"]' } }), 400],
    ['a plain string', JSON.stringify({ ...base, extraFrontmatter: { tags: 'harmless' } }), 400],
    ['an object', JSON.stringify({ ...base, extraFrontmatter: { tags: { a: 1 } } }), 400],
    ['a number', JSON.stringify({ ...base, extraFrontmatter: { tags: 7 } }), 400],
    ['null', JSON.stringify({ ...base, extraFrontmatter: { tags: null } }), 'flagged'],
    ['a duplicate tags key', '{"templatePath":"templates/charlie-key.md","targetPath":"semantic/copy.md","title":"Copy","extraFrontmatter":{"tags":["contains-secrets"],"tags":[]}}', 'flagged'],
    ['a correctly shaped array', JSON.stringify({ ...base, extraFrontmatter: { tags: ['mine'] } }), 'flagged'],
  ]

  for (const [name, rawBody, expected] of shapes) {
    it(`${name} ends ${expected === 400 ? 'in a 400, not a 500' : 'with the copy flagged'}`, async () => {
      const res = await copyWith(rawBody)
      if (expected === 400) {
        expect(res.status).toBe(400)
        expect(memory.vault.exists('semantic/copy.md')).toBe(false)
        return
      }
      expect(res.status).toBe(201)
      // Read back through the real parser: the only tags that count are the
      // ones the store actually kept.
      expect(memory.vault.read('semantic/copy.md')!.frontmatter.tags).toContain('contains-secrets')
    })

    it(`${name} never reaches doors 1 or 2, search, or the embedder`, async () => {
      await copyWith(rawBody)
      memory.indexer.indexAll()
      if (!memory.vault.exists('semantic/copy.md')) return

      expect(await json('/api/v1/memory/vault', mountAs('agent'))).not.toContain('semantic/copy.md')
      expect((await mountAs('agent').request('/api/v1/memory/vault/semantic/copy.md')).status).toBe(404)
      expect(await memory.search({ query: 'template body' })).toEqual([])

      const sent: string[] = []
      const service = createEmbeddingService({
        db,
        vecStore: {
          ready: () => true, ensureDimension: () => true,
          upsertEpisodic: () => {}, upsertVault: () => {},
          deleteEpisodic: () => {}, deleteVault: () => {},
          searchEpisodic: () => [], searchVault: () => [],
          stats: () => ({ episodicCount: 0, vaultCount: 0, dimension: 3 }),
        } as any,
        bridge: {
          canEmbed: () => true,
          async embed(texts: string[]) { sent.push(...texts); return texts.map(() => [0.1, 0.2, 0.3]) },
          dimensions: () => 3,
        },
        recall: () => ({ includeSecrets: false }),
      })
      await service.backfill(50)
      expect(sent.join('\n')).not.toContain(KEY)
    })
  }

  it('the same string cannot un-flag a note through the overwrite route either', async () => {
    const res = await mountAs('owner').request('/api/v1/memory/vault/templates/charlie-key.md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontmatter: { ...fm({ title: 'Charlie key' }), tags: '["contains-secrets"]' }, content: 'rewritten' }),
    })
    expect(res.status).toBe(400)
    expect(memory.vault.read('templates/charlie-key.md')!.frontmatter.tags).toContain('contains-secrets')
  })

  it('an array of non-strings is stored as the strings the reader will keep', async () => {
    const res = await copyWith(JSON.stringify({ ...base, extraFrontmatter: { tags: [1, 2] } }))
    expect(res.status).toBe(201)
    const tags = memory.vault.read('semantic/copy.md')!.frontmatter.tags
    expect(tags).toEqual(['1', '2', 'contains-secrets'])
  })
})
