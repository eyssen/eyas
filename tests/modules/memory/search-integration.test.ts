// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createWorkingMemoryService } from '../../../src/modules/memory/tiers/working-memory.js'
import { createEpisodicMemoryService } from '../../../src/modules/memory/tiers/episodic-memory.js'
import { createArchiveMemoryService } from '../../../src/modules/memory/tiers/archive-memory.js'
import { createVaultService } from '../../../src/modules/memory/vault/vault-service.js'
import { createVaultIndexer } from '../../../src/modules/memory/vault/vault-indexer.js'
import { createWikilinkService } from '../../../src/shared/wikilinks.js'
import { createMemoryService } from '../../../src/modules/memory/memory-service.js'

describe('MemoryService hybrid search (FTS5 + RRF)', () => {
  let db: ReturnType<typeof createMemoryDb>
  let vaultPath: string
  let memory: ReturnType<typeof createMemoryService>

  beforeEach(() => {
    db = createMemoryDb()
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-search-'))
    createMemoryTables(db)
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
    const episodic = createEpisodicMemoryService(db)
    const archive = createArchiveMemoryService(db)
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)
    memory = createMemoryService({ working, episodic, archive, vault, indexer, wikilinks, db })
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('finds episodic memories via FTS5 MATCH, not substring', async () => {
    memory.episodic.create({ content: 'Kubernetes deployment guide for OKE clusters', sourceType: 'user' })
    memory.episodic.create({ content: 'Odoo port configuration on 8069', sourceType: 'user' })
    memory.episodic.create({ content: 'Unrelated note about weather', sourceType: 'user' })

    const results = await memory.search({ query: 'kubernetes' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe('episodic')
    expect(results[0].content.toLowerCase()).toContain('kubernetes')
  })

  it('searches vault tier (previously skipped)', async () => {
    memory.vault.write('semantic/k8s.md', {
      title: 'Kubernetes Patterns', tags: ['k8s'], tier: 'semantic',
      links: [], created: '2026-04-19', updated: '2026-04-19',
    }, '# Kubernetes patterns\nDeployments, services, ingress.')
    memory.vault.write('procedural/deploy.md', {
      title: 'Deploy guide', tags: ['deploy'], tier: 'procedural',
      links: [], created: '2026-04-19', updated: '2026-04-19',
    }, '# How to deploy a service with rolling updates.')
    memory.indexer.indexAll()

    const results = await memory.search({ query: 'deploy' })
    expect(results.some(r => r.source === 'vault')).toBe(true)
  })

  it('filters by agentId with includeShared default-true', async () => {
    memory.episodic.create({ content: 'Agent A specific finding about auth', sourceType: 'system', agentId: 'agent-a' })
    memory.episodic.create({ content: 'Agent B specific finding about auth', sourceType: 'system', agentId: 'agent-b' })
    memory.episodic.create({ content: 'Shared team finding about auth', sourceType: 'system' })

    const resultsA = await memory.search({ query: 'auth', agentId: 'agent-a' })
    const ids = resultsA.map(r => r.content)
    expect(ids.some(c => c.includes('Agent A'))).toBe(true)
    expect(ids.some(c => c.includes('Shared team'))).toBe(true)
    expect(ids.some(c => c.includes('Agent B'))).toBe(false)
  })

  it('escapes special FTS5 characters safely', async () => {
    memory.episodic.create({ content: 'error code 0x80004005 on startup', sourceType: 'system' })
    // Query contains a double-quote that must not break MATCH parsing.
    const results = await memory.search({ query: 'error "code"' })
    expect(Array.isArray(results)).toBe(true)
  })

  it('respects tiers filter', async () => {
    memory.vault.write('semantic/note.md', {
      title: 'Note', tags: [], tier: 'semantic',
      links: [], created: '2026-04-19', updated: '2026-04-19',
    }, 'semantic content about routing')
    memory.indexer.indexAll()
    memory.episodic.create({ content: 'episodic note about routing', sourceType: 'user' })

    const onlyEpisodic = await memory.search({ query: 'routing', tiers: ['episodic'] })
    expect(onlyEpisodic.every(r => r.source === 'episodic')).toBe(true)

    const onlyVault = await memory.search({ query: 'routing', tiers: ['semantic'] })
    expect(onlyVault.every(r => r.source === 'vault')).toBe(true)
  })
})
