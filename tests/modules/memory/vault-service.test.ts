// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createVaultService } from '../../../src/modules/memory/vault/vault-service.js'
import { createVaultIndexer } from '../../../src/modules/memory/vault/vault-indexer.js'
import { createWikilinkService } from '../../../src/shared/wikilinks.js'

describe('VaultService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let vaultPath: string
  let service: ReturnType<typeof createVaultService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-vault-test-'))
    service = createVaultService(vaultPath)
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('writes and reads a vault file', () => {
    service.write('semantic/test-note.md', {
      title: 'Test Note', tags: ['test'], tier: 'semantic',
      links: [], created: '2026-04-02', updated: '2026-04-02',
    }, '# Test Note\nSome content.')

    const entry = service.read('semantic/test-note.md')
    expect(entry).not.toBeNull()
    expect(entry!.frontmatter.title).toBe('Test Note')
    expect(entry!.content).toContain('# Test Note')
  })

  it('lists vault files', () => {
    service.write('semantic/a.md', { title: 'A', tags: [], tier: 'semantic', links: [], created: '2026-04-02', updated: '2026-04-02' }, 'Content A')
    service.write('procedural/b.md', { title: 'B', tags: [], tier: 'procedural', links: [], created: '2026-04-02', updated: '2026-04-02' }, 'Content B')
    const files = service.listFiles()
    expect(files).toHaveLength(2)
  })

  it('deletes a vault file', () => {
    service.write('semantic/to-delete.md', { title: 'Delete', tags: [], tier: 'semantic', links: [], created: '2026-04-02', updated: '2026-04-02' }, 'Content')
    service.delete('semantic/to-delete.md')
    expect(service.read('semantic/to-delete.md')).toBeNull()
  })
})

describe('VaultIndexer', () => {
  let db: ReturnType<typeof createMemoryDb>
  let vaultPath: string
  let service: ReturnType<typeof createVaultService>
  let wikilinks: ReturnType<typeof createWikilinkService>
  let indexer: ReturnType<typeof createVaultIndexer>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    wikilinks = createWikilinkService(db)
    wikilinks.init()
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-vault-idx-'))
    service = createVaultService(vaultPath)
    indexer = createVaultIndexer(db, service, wikilinks)
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  it('indexes vault files into DB', () => {
    service.write('semantic/k8s.md', {
      title: 'Kubernetes', tags: ['k8s'], tier: 'semantic',
      links: [], created: '2026-04-02', updated: '2026-04-02',
    }, '# Kubernetes\nCluster docs with [[networking]] link.')

    const count = indexer.indexAll()
    expect(count).toBe(1)

    const outgoing = wikilinks.getOutgoing('vault', 'semantic/k8s.md')
    expect(outgoing).toHaveLength(1)
  })

  it('skips unchanged files on re-index', () => {
    service.write('semantic/stable.md', {
      title: 'Stable', tags: [], tier: 'semantic',
      links: [], created: '2026-04-02', updated: '2026-04-02',
    }, 'Unchanged content.')

    indexer.indexAll()
    const count = indexer.indexAll()
    expect(count).toBe(0)
  })
})
