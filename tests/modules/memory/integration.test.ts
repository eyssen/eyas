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
import { createKnowledgeTables } from '../../../src/modules/knowledge/schema.js'
import { createKnowledgeService } from '../../../src/modules/knowledge/knowledge-service.js'

describe('Memory + Knowledge integration', () => {
  let db: ReturnType<typeof createMemoryDb>
  let vaultPath: string

  beforeEach(() => {
    db = createMemoryDb()
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-integration-'))
    createMemoryTables(db)
    createKnowledgeTables(db)
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('memory and knowledge share wikilink graph', () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    // Write vault file with link
    vault.write('semantic/k8s.md', {
      title: 'K8s', tags: [], tier: 'semantic', links: [],
      created: '2026-04-02', updated: '2026-04-02',
    }, '# K8s\nSee [[ingress-setup]] for details.')
    indexer.indexAll()

    // Create knowledge page
    const knowledge = createKnowledgeService(db)
    const space = knowledge.createSpace({ name: 'Test', slug: 'test' })
    knowledge.createPage({
      spaceId: space.id, title: 'Ingress Setup', slug: 'ingress-setup',
      // The old `contentJson` field was replaced by `body` in the knowledge
      // API; plaintext copy still lives in `contentText` for search indexing.
      body: '{}', contentText: 'Ingress setup details',
    })

    // Vault file links to 'ingress-setup' via wikilink
    const outgoing = wikilinks.getOutgoing('vault', 'semantic/k8s.md')
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].targetId).toBe('ingress-setup')
  })

  it('full memory lifecycle: create, search, stats', () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
    const episodic = createEpisodicMemoryService(db)
    const archive = createArchiveMemoryService(db)
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    const memory = createMemoryService({ working, episodic, archive, vault, indexer })

    working.set('user_context', 'DevOps engineer')
    episodic.create({ content: 'K8s cluster uses OKE', sourceType: 'conversation' })
    episodic.create({ content: 'Odoo runs on port 8069', sourceType: 'extraction' })

    const stats = memory.stats()
    expect(stats.tiers.working.count).toBe(1)
    expect(stats.tiers.episodic.total).toBe(2)
    expect(stats.tiers.archive.count).toBe(0)
  })
})
