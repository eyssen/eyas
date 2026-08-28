// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../../helpers/test-db'
import { createMemoryTables } from '../../../../src/modules/memory/schema.js'
import { createVaultService } from '../../../../src/modules/memory/vault/vault-service.js'
import { createVaultIndexer } from '../../../../src/modules/memory/vault/vault-indexer.js'
import { createWikilinkService } from '../../../../src/shared/wikilinks.js'
import { createSemanticPromoter } from '../../../../src/modules/memory/consolidator/semantic-promoter.js'
import type { EpisodicMemory } from '../../../../src/modules/memory/types.js'

function makeMember(id: string, content: string): EpisodicMemory {
  return {
    id, content, sourceType: 'user', sourceId: null, salience: 0.9,
    accessCount: 5, conversationCount: 2, validFrom: '2026-04-19', validUntil: null,
    tags: [], embeddingHash: null, agentId: null,
    createdAt: '2026-04-19T00:00:00Z', lastAccessedAt: '2026-04-19T00:00:00Z',
  }
}

describe('SemanticPromoter', () => {
  let vaultPath: string
  let db: ReturnType<typeof createMemoryDb>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-sempromo-'))
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('writes a vault note when LLM returns valid JSON', async () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    const fakeGateway = {
      complete: async () => ({
        text: JSON.stringify({
          title: 'Kubernetes deployment pattern',
          body: 'Users consistently deploy services via Helm charts with a canonical values.yaml. ' +
            'The OKE cluster uses the oci-bv storageClass. Services expose /health and /ready probes. ' +
            'Rolling updates use maxSurge=1, maxUnavailable=0.',
        }),
      }),
    } as any

    const promoter = createSemanticPromoter({ gateway: fakeGateway, vault, indexer })
    const result = await promoter.promoteCluster([
      makeMember('a', 'Deploy via Helm'),
      makeMember('b', 'Use oci-bv storage'),
      makeMember('c', 'Health probes on /health'),
    ])

    expect(result).not.toBeNull()
    expect(result!.path).toMatch(/^semantic\/auto\/.*\.md$/)

    const entry = vault.read(result!.path)
    expect(entry).not.toBeNull()
    expect(entry!.frontmatter.title).toBe('Kubernetes deployment pattern')
    expect(entry!.frontmatter.tier).toBe('semantic')
    expect(entry!.content).toContain('Provenance')
    expect(entry!.content).toContain('ep:a')
  })

  it('writes a vault note from a ContentBlock[] response (real ModelResponse shape)', async () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    // The real gateway.complete returns ModelResponse.content as a
    // ContentBlock[] array with no `.text` field — reading resp.text ?? resp.content
    // previously bound the array and crashed parseLlmJson.
    const fakeGateway = {
      complete: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              title: 'Content-block consolidation',
              body: 'Distilled canonical knowledge extracted from repeated episodic memories. ' +
                'This body is long enough to pass the 50-char minimum body-length guard in the parser.',
            }),
          },
        ],
      }),
    } as any

    const promoter = createSemanticPromoter({ gateway: fakeGateway, vault, indexer })
    const result = await promoter.promoteCluster([
      makeMember('a', 'x'),
      makeMember('b', 'y'),
    ])

    expect(result).not.toBeNull()
    const entry = vault.read(result!.path)
    expect(entry).not.toBeNull()
    expect(entry!.frontmatter.title).toBe('Content-block consolidation')
  })

  it('returns null on LLM failure (fallback to invalidate-only)', async () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    const fakeGateway = {
      complete: async () => { throw new Error('LLM down') },
    } as any

    const promoter = createSemanticPromoter({ gateway: fakeGateway, vault, indexer })
    const result = await promoter.promoteCluster([makeMember('a', 'x')])
    expect(result).toBeNull()
  })

  it('returns null when LLM output is unparseable', async () => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const vault = createVaultService(vaultPath)
    const indexer = createVaultIndexer(db, vault, wikilinks)

    const fakeGateway = {
      complete: async () => ({ text: 'definitely not JSON' }),
    } as any

    const promoter = createSemanticPromoter({ gateway: fakeGateway, vault, indexer })
    const result = await promoter.promoteCluster([makeMember('a', 'x')])
    expect(result).toBeNull()
  })
})
