// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { effectiveProjectId, MEMORY_DEFAULT_PROJECT_ID } from '@modules/memory/types'

let db: any, root: string

beforeEach(() => {
  db = createMemoryDb(); createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-scoping-'))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scoping schema', () => {
  it('stamps conversation and project onto an episodic row', () => {
    const episodic = createEpisodicMemoryService(db)
    const m = episodic.create({
      content: 'the owner ships on Fridays', sourceType: 'agent-memory',
      conversationId: 'conv-1', projectId: 'proj-1',
    })
    const row = (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories WHERE id = ${m.id}`) as any[])[0]
    expect(row).toEqual({ conversation_id: 'conv-1', project_id: 'proj-1' })
    expect(m.conversationId).toBe('conv-1')
    expect(m.projectId).toBe('proj-1')
  })

  it('projects frontmatter `project` into vault_index.project_id', () => {
    mkdirSync(join(root, 'projects', 'proj-1'), { recursive: true })
    writeFileSync(join(root, 'projects', 'proj-1', 'deploy-rule.md'),
      '---\ntitle: Deploy rule\ntier: semantic\nkind: project\nproject: proj-1\nsummary: Deploys need a green pipeline\n---\nBody.\n')
    const vault = createVaultService(root)
    const wikilinks = createWikilinkService(db); wikilinks.init()
    createVaultIndexer(db, vault, wikilinks).indexAll()
    const row = (db.all(sql`SELECT project_id, kind FROM vault_index WHERE path = ${'projects/proj-1/deploy-rule.md'}`) as any[])[0]
    expect(row).toEqual({ project_id: 'proj-1', kind: 'project' })
  })

  it('projects frontmatter `projectType` into vault_index.project_type_id', () => {
    mkdirSync(join(root, 'project-types', 'type-a'), { recursive: true })
    writeFileSync(join(root, 'project-types', 'type-a', 'shared-rule.md'),
      '---\ntitle: Shared rule\ntier: semantic\nkind: domain\nprojectType: type-a\nsummary: Tax groups are shared across the type\n---\nBody.\n')
    const vault = createVaultService(root)
    const wikilinks = createWikilinkService(db); wikilinks.init()
    createVaultIndexer(db, vault, wikilinks).indexAll()
    const row = (db.all(sql`SELECT project_id, project_type_id, kind FROM vault_index WHERE path = ${'project-types/type-a/shared-rule.md'}`) as any[])[0]
    expect(row).toEqual({ project_id: null, project_type_id: 'type-a', kind: 'domain' })
  })

  it('memory_note_links dedupes on its primary key', () => {
    db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id) VALUES ('semantic/a.md', 'conversations', 'c1')`)
    db.run(sql`INSERT OR IGNORE INTO memory_note_links (note_path, owner_module, owner_id) VALUES ('semantic/a.md', 'conversations', 'c1')`)
    const n = (db.all(sql`SELECT COUNT(*) AS n FROM memory_note_links`) as any[])[0].n
    expect(Number(n)).toBe(1)
  })

  it('memory_capture_runs accepts a run row with kinds', () => {
    db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, kinds) VALUES ('c1', 2, '["user","project"]')`)
    const row = (db.all(sql`SELECT notes_written, kinds FROM memory_capture_runs WHERE conversation_id = 'c1'`) as any[])[0]
    expect(row.notes_written).toBe(2)
    expect(JSON.parse(row.kinds)).toEqual(['user', 'project'])
  })

  it('treats the seed project as no project — a catch-all is not an identity', () => {
    expect(effectiveProjectId(MEMORY_DEFAULT_PROJECT_ID)).toBeNull()
    expect(effectiveProjectId(null)).toBeNull()
    expect(effectiveProjectId(undefined)).toBeNull()
    expect(effectiveProjectId('proj-1')).toBe('proj-1')
  })
})
