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
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)
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

  it('scope=all from alpha includes the sibling project note', async () => {
    const r = await harness.run(
      'search_memory',
      { query: 'zebra', scope: 'all' },
      { projectId: 'alpha' },
    )

    expect(r.success).toBe(true)
    const text = contents(r.output)
    expect(text).toContain('zebra-bravo')
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

  it('advertises scope=all as an explicit opt-in, not the default', () => {
    const tool = harness.registry.get('search_memory')!
    const scope = (tool.inputSchema as { properties: { scope: { enum: string[] } } }).properties.scope
    expect(scope.enum).toEqual(['current', 'all'])
  })
})
