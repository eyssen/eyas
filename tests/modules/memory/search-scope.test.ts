// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createToolContractHarness } from '../../helpers/tool-contract'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'
import type { VaultFrontmatter } from '@modules/memory/types'

/**
 * Item 24: search_memory default scope is the active project + its type +
 * global notes. Other projects stay out unless the model asks for scope=all.
 * Fixture names are fictive (constraint 17).
 */

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let harness: ReturnType<typeof createToolContractHarness>
// Module scope so a single test can add a note and re-index after beforeEach.
let vault: ReturnType<typeof createVaultService>
let indexer: ReturnType<typeof createVaultIndexer>

const fm = (over: Partial<VaultFrontmatter> = {}): VaultFrontmatter => ({
  title: 'Note',
  tags: [],
  tier: 'semantic',
  links: [],
  created: '2026-08-30',
  updated: '2026-08-30',
  ...over,
})

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('alpha', 'Alpha', 'type-a')`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('bravo', 'Bravo', 'type-a')`)

  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-search-scope-'))
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  vault = createVaultService(vaultPath)
  indexer = createVaultIndexer(db, vault, wikilinks)
  memory = createMemoryService({
    working: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
    episodic: createEpisodicMemoryService(db),
    archive: createArchiveMemoryService(db),
    vault,
    indexer,
    wikilinks,
    db,
  })

  vault.write('projects/alpha/ticket.md', fm({
    title: 'Alpha ticket',
    kind: 'project',
    project: 'alpha',
    summary: 'Alpha ticket constraint',
  }), 'alpha-ticket-constraint zebra-alpha lives only on this project')
  vault.write('projects/bravo/local.md', fm({
    title: 'Bravo local',
    kind: 'project',
    project: 'bravo',
    summary: 'Bravo is pod-only',
  }), 'bravo-pod-only zebra-bravo is a sibling project fact')
  vault.write('project-types/type-a/shared-rule.md', fm({
    title: 'Shared type rule',
    kind: 'domain',
    projectType: 'type-a',
    summary: 'Shared type rule',
  }), 'shared-type-rule zebra-type applies to every project of this type')
  vault.write('semantic/owner.md', fm({
    title: 'Owner',
    kind: 'user',
    summary: 'Works in Hungarian',
  }), 'works-in-hungarian zebra-user is a global owner fact')
  indexer.indexAll()

  harness = createToolContractHarness(createMemoryTools(() => memory))
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

function contents(output: unknown): string {
  const results = (output as { results?: Array<{ content?: string }> }).results ?? []
  return results.map((r) => r.content ?? '').join('\n')
}

describe('search_memory default scope (item 24)', () => {
  it('from alpha, default search does not return bravo project notes', async () => {
    const r = await harness.run('search_memory', { query: 'zebra' }, { projectId: 'alpha' })

    expect(r.success).toBe(true)
    const text = contents(r.output)
    expect(text).toContain('zebra-alpha')
    expect(text).toContain('zebra-type')
    expect(text).toContain('zebra-user')
    expect(text).not.toContain('zebra-bravo')
  })

  it('from bravo, default search does not return alpha project notes', async () => {
    const r = await harness.run('search_memory', { query: 'zebra' }, { projectId: 'bravo' })

    expect(r.success).toBe(true)
    const text = contents(r.output)
    expect(text).toContain('zebra-bravo')
    expect(text).toContain('zebra-type')
    expect(text).not.toContain('zebra-alpha')
  })

  it('ignores a model-supplied scope=all — another project is a UI action', async () => {
    const r = await harness.run(
      'search_memory',
      { query: 'zebra', scope: 'all' },
      { projectId: 'alpha' },
    )

    expect(r.success).toBe(true)
    const text = contents(r.output)
    expect(text).not.toContain('zebra-bravo')
    expect(text).toContain('zebra-alpha')
  })

  it('projectless default (general-general) keeps global notes and hides project notes', async () => {
    const r = await harness.run(
      'search_memory',
      { query: 'zebra' },
      { projectId: 'general-general' },
    )

    expect(r.success).toBe(true)
    const text = contents(r.output)
    expect(text).toContain('zebra-user')
    expect(text).not.toContain('zebra-alpha')
    expect(text).not.toContain('zebra-bravo')
    expect(text).not.toContain('zebra-type')
  })

  it('an unscoped project note is found from any project and from no project', async () => {
    // D-2: no declared project means global, not invisible.
    vault.write('semantic/unscoped.md', fm({
      title: 'Unscoped fact',
      kind: 'project',
      summary: 'Unscoped fact',
    }), 'zebra-unscoped names no project and belongs to every conversation')
    indexer.indexAll()

    const fromAlpha = await harness.run('search_memory', { query: 'zebra' }, { projectId: 'alpha' })
    expect(fromAlpha.success).toBe(true)
    expect(contents(fromAlpha.output)).toContain('zebra-unscoped')

    const fromNoProject = await harness.run('search_memory', { query: 'zebra' }, { projectId: 'general-general' })
    expect(fromNoProject.success).toBe(true)
    expect(contents(fromNoProject.output)).toContain('zebra-unscoped')
  })

  it('does not advertise a scope or projectId argument', () => {
    const tool = harness.registry.get('memory_search')!
    const props = (tool.inputSchema as { properties: Record<string, unknown> }).properties
    expect(props.scope).toBeUndefined()
    expect(props.projectId).toBeUndefined()
  })
})

// D-7 / P-19 — `search_memory` is the most direct model-facing consumer of the
// vault and of episodic rows. A note the importer flagged as holding a
// credential is stored verbatim and must stay out of a result set unless the
// owner opened `memory.recall.includeSecrets`.
describe('contains-secrets recall', () => {
  it('hides tagged rows from search unless the config or an explicit call says otherwise', async () => {
    vault.write('semantic/alpha-key.md', fm({ title: 'Alpha key', tags: ['contains-secrets'] }), 'zxq alpha credential body')
    indexer.indexAll()
    memory.episodic.create({ content: 'zxq alpha credential row', sourceType: 'system', tags: ['contains-secrets'] })

    expect(await memory.search({ query: 'zxq alpha credential' })).toEqual([])
    expect((await memory.search({ query: 'zxq alpha credential', includeSecrets: true })).length).toBe(2)

    const open = createMemoryService({
      working: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
      episodic: createEpisodicMemoryService(db),
      archive: createArchiveMemoryService(db),
      vault,
      indexer,
      db,
      recall: () => ({ includeSecrets: true }),
    })
    expect((await open.search({ query: 'zxq alpha credential' })).length).toBe(2)
    expect(await open.search({ query: 'zxq alpha credential', includeSecrets: false })).toEqual([])
  })

  it('keeps a flagged note out of the tool result too, not only out of the service', async () => {
    vault.write('semantic/bravo-key.md', fm({ title: 'Bravo key', tags: ['contains-secrets'] }), 'zxq bravo credential body')
    indexer.indexAll()

    const r = await harness.run('search_memory', { query: 'zxq bravo credential' }, { projectId: 'alpha' })
    expect(r.success).toBe(true)
    expect(contents(r.output)).not.toContain('zxq bravo credential')
  })

  it('excerpts an oversized episodic hit instead of returning the whole body', async () => {
    memory.episodic.create({
      content: `${'alpha '.repeat(30_000)} zxq-needle ${'bravo '.repeat(30_000)}`,
      sourceType: 'system',
    })

    const [hit] = await memory.search({ query: 'zxq-needle', tiers: ['episodic'] })
    expect(hit.content.length).toBeLessThan(3_200)
    expect(hit.content).toContain('zxq-needle')
    expect(hit.metadata.truncated).toBe(true)
    expect(hit.metadata.contentLength).toBeGreaterThan(300_000)
  })

  it('leaves a short episodic hit byte-for-byte alone', async () => {
    memory.episodic.create({ content: 'zxq charlie short row', sourceType: 'system' })
    const [hit] = await memory.search({ query: 'zxq charlie short', tiers: ['episodic'] })
    expect(hit.content).toBe('zxq charlie short row')
    expect(hit.metadata.truncated).toBeUndefined()
  })
})
