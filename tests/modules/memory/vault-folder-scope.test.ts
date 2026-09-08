// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I10 — the product documents, in all six languages, that moving a note into
// `projects/<id>/` scopes it to that project. Until now only frontmatter said
// so, and an unscoped note is global: a `kind: project` note filed under
// `projects/alpha/` with no `project:` key surfaced in every OTHER project too.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'

let db: any
let root: string

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-folder-scope-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** The board tables the folder rule consults; absent until the board module runs. */
function createBoardTables(): void {
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
  db.run(sql`INSERT INTO projects VALUES ('alpha', 'Alpha')`)
  db.run(sql`INSERT INTO project_types VALUES ('type-a', 'Type A')`)
}

function note(relPath: string, frontmatter: string, body = 'Body.\n'): void {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, `---\n${frontmatter}---\n${body}`)
}

function indexAll(): void {
  const vault = createVaultService(root)
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  createVaultIndexer(db, vault, wikilinks).indexAll()
}

function scopeOf(path: string): { project_id: string | null; project_type_id: string | null } {
  return (
    db.all(
      sql`SELECT project_id, project_type_id FROM vault_index WHERE path = ${path}`,
    ) as any[]
  )[0]
}

describe('vault indexer — the folder a note sits in', () => {
  it('scopes a note whose folder names a project it has, without any frontmatter key', () => {
    createBoardTables()
    note('projects/alpha/moved.md', 'title: Moved note\ntier: semantic\nkind: project\n')
    indexAll()
    expect(scopeOf('projects/alpha/moved.md')).toEqual({
      project_id: 'alpha',
      project_type_id: null,
    })
  })

  it('does the same for a project type', () => {
    createBoardTables()
    note('project-types/type-a/shared.md', 'title: Shared\ntier: semantic\nkind: domain\n')
    indexAll()
    expect(scopeOf('project-types/type-a/shared.md')).toEqual({
      project_id: null,
      project_type_id: 'type-a',
    })
  })

  it('lets the note speak for itself: frontmatter wins over the folder', () => {
    createBoardTables()
    db.run(sql`INSERT INTO projects VALUES ('bravo', 'Bravo')`)
    note('projects/alpha/declared.md', 'title: Declared\ntier: semantic\nkind: project\nproject: bravo\n')
    indexAll()
    expect(scopeOf('projects/alpha/declared.md').project_id).toBe('bravo')
  })

  it('leaves a folder that names no project of this instance global', () => {
    createBoardTables()
    // `projects/daily/` and `projects/team-sessions/` are vault conventions, not
    // projects: scoping them to an id nothing has would hide them from
    // everything instead of narrowing them to something.
    note('projects/daily/2026-09-05.md', 'title: Daily\ntier: semantic\nkind: reference\n')
    indexAll()
    expect(scopeOf('projects/daily/2026-09-05.md')).toEqual({
      project_id: null,
      project_type_id: null,
    })
  })

  it('keeps a note global when there is no board module to ask', () => {
    // No `projects` table at all: unverifiable, so the note stays exactly as
    // visible as it was rather than disappearing into an unresolvable scope.
    note('projects/alpha/moved.md', 'title: Moved\ntier: semantic\nkind: project\n')
    indexAll()
    expect(scopeOf('projects/alpha/moved.md').project_id).toBeNull()
  })

  it('reads nothing into a top-level note, or one in an unrelated folder', () => {
    createBoardTables()
    note('semantic/plain.md', 'title: Plain\ntier: semantic\nkind: reference\n')
    note('procedural/rule.md', 'title: Rule\ntier: procedural\nkind: feedback\n')
    indexAll()
    expect(scopeOf('semantic/plain.md')).toEqual({ project_id: null, project_type_id: null })
    expect(scopeOf('procedural/rule.md')).toEqual({ project_id: null, project_type_id: null })
  })

  it('re-scopes an index row written before the rule existed, on the next pass', () => {
    createBoardTables()
    note('projects/alpha/moved.md', 'title: Moved\ntier: semantic\nkind: project\n')
    indexAll()
    // A row from a build that derived scope from frontmatter alone. The file is
    // unchanged, so only a hash mismatch brings it back through the indexer —
    // which is what a real edit, or this stand-in for one, produces.
    db.run(
      sql`UPDATE vault_index SET project_id = NULL, file_hash = 'stale' WHERE path = 'projects/alpha/moved.md'`,
    )
    indexAll()
    expect(scopeOf('projects/alpha/moved.md').project_id).toBe('alpha')
  })

  it('scopes a note once the project it names is created, without a restart', () => {
    createBoardTables()
    db.run(sql`DELETE FROM projects WHERE id = 'alpha'`)
    // ONE indexer for the whole test, because production holds exactly one for
    // the life of the process. A cache that outlived a pass would remember
    // "there is no project alpha" for ever, and the D-5 order the docs describe
    // — import a vault whose `projects/<id>/` folders name projects, then create
    // those projects — would leave every one of those notes global.
    const vault = createVaultService(root)
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    const indexer = createVaultIndexer(db, vault, wikilinks)

    note('projects/alpha/moved.md', 'title: Moved\ntier: semantic\nkind: project\n')
    indexer.indexAll()
    expect(scopeOf('projects/alpha/moved.md').project_id).toBeNull()

    db.run(sql`INSERT INTO projects VALUES ('alpha', 'Alpha')`)
    // The file has not changed, so the hash gate skips it; a later edit is what
    // brings it back through. That much is pre-existing — what matters here is
    // that the SAME indexer now answers `alpha` rather than its stale `no`.
    db.run(sql`UPDATE vault_index SET file_hash = 'stale' WHERE path = 'projects/alpha/moved.md'`)
    indexer.indexAll()
    expect(scopeOf('projects/alpha/moved.md').project_id).toBe('alpha')
  })

  it('asks the database once per distinct id however many notes share the folder', () => {
    createBoardTables()
    let lookups = 0
    const counting: any = {
      run: (q: unknown) => db.run(q),
      get: (q: unknown) => db.get(q),
      all: (q: unknown) => {
        if (JSON.stringify(q).includes('FROM projects')) lookups++
        return db.all(q)
      },
    }
    for (let i = 0; i < 5; i++) {
      note(`projects/alpha/n${i}.md`, `title: Note ${i}\ntier: semantic\nkind: project\n`)
    }
    const vault = createVaultService(root)
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    createVaultIndexer(counting, vault, wikilinks).indexAll()

    expect(lookups).toBe(1)
    expect(scopeOf('projects/alpha/n4.md').project_id).toBe('alpha')
  })
})
