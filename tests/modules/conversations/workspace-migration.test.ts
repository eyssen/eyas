// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Legacy <dataDir>/workspaces/<id> folders move to the workspaces root, and
// only the conversation Folders that are those auto workspaces are repointed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { isBun } from '@shared/platform'
import { createMemoryDb } from '../../helpers/test-db.js'
import { migrateLegacyWorkspaces } from '@modules/conversations/workspace-migration.js'
import { relocateLegacyWorkspaces } from '@modules/conversations/index.js'

function fileDb(path: string): any {
  if (isBun) {
    const { Database } = require('bun:sqlite')
    const { drizzle } = require('drizzle-orm/bun-sqlite')
    return drizzle(new Database(path))
  }
  const BetterSqlite3 = require('better-sqlite3')
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  return drizzle(new BetterSqlite3(path))
}

function makeTable(db: any): void {
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, working_directories TEXT)`)
}

function insert(db: any, id: string, dirs: unknown): void {
  db.run(sql`INSERT INTO conversations (id, working_directories) VALUES (${id}, ${dirs == null ? null : JSON.stringify(dirs)})`)
}

function dirsOf(db: any, id: string): unknown {
  const [row] = db.all(sql`SELECT working_directories FROM conversations WHERE id = ${id}`) as Array<{ working_directories: string | null }>
  return row.working_directories == null ? null : JSON.parse(row.working_directories)
}

const logger = () => ({ info: vi.fn(), warn: vi.fn() })

let tmp: string
let legacyRoot: string
let newRoot: string
let userFolder: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-wsmig-')))
  legacyRoot = join(tmp, 'repo', 'data', 'workspaces')
  newRoot = join(tmp, 'appdata', 'eyas', 'repo-abc', 'workspaces')
  userFolder = join(tmp, 'projects', 'site')
  mkdirSync(userFolder, { recursive: true })
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('migrateLegacyWorkspaces', () => {
  it('moves the auto workspaces and repoints exactly the Folders that were auto workspaces', () => {
    mkdirSync(join(legacyRoot, 'convA'), { recursive: true })
    writeFileSync(join(legacyRoot, 'convA', 'report.html'), '<p>kept</p>')
    mkdirSync(join(legacyRoot, 'convB'), { recursive: true })
    const db = createMemoryDb()
    makeTable(db)
    insert(db, 'convA', [join(legacyRoot, 'convA')])
    insert(db, 'childOfB', [{ name: 'parent', path: join(legacyRoot, 'convB') }])
    insert(db, 'user', [userFolder])
    insert(db, 'nested', [join(legacyRoot, 'convA', 'sub')])
    insert(db, 'mixed', [userFolder, join(legacyRoot, 'convA')])
    insert(db, 'none', null)

    const log = logger()
    const result = migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: log })

    expect(result).toEqual({ moved: 2, rewritten: 3, kept: 0 })
    expect(readFileSync(join(newRoot, 'convA', 'report.html'), 'utf-8')).toBe('<p>kept</p>')
    expect(existsSync(join(newRoot, 'convB'))).toBe(true)
    expect(existsSync(legacyRoot)).toBe(false)

    expect(dirsOf(db, 'convA')).toEqual([join(newRoot, 'convA')])
    expect(dirsOf(db, 'childOfB')).toEqual([{ name: 'parent', path: join(newRoot, 'convB') }])
    expect(dirsOf(db, 'mixed')).toEqual([userFolder, join(newRoot, 'convA')])
    // A Folder the user chose is never touched.
    expect(dirsOf(db, 'user')).toEqual([userFolder])
    expect(dirsOf(db, 'nested')).toEqual([join(legacyRoot, 'convA', 'sub')])
    expect(dirsOf(db, 'none')).toBeNull()
    expect(log.info).toHaveBeenCalledTimes(1)
  })

  it('is idempotent', () => {
    mkdirSync(join(legacyRoot, 'convA'), { recursive: true })
    const db = createMemoryDb()
    makeTable(db)
    insert(db, 'convA', [join(legacyRoot, 'convA')])
    migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: logger() })
    const log = logger()
    expect(migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: log })).toEqual({ moved: 0, rewritten: 0, kept: 0 })
    expect(log.info).not.toHaveBeenCalled()
    expect(dirsOf(db, 'convA')).toEqual([join(newRoot, 'convA')])
  })

  it('does nothing when the roots are the same place', () => {
    mkdirSync(join(legacyRoot, 'convA'), { recursive: true })
    const db = createMemoryDb()
    makeTable(db)
    insert(db, 'convA', [join(legacyRoot, 'convA')])
    expect(migrateLegacyWorkspaces({ db, legacyRoot, newRoot: legacyRoot, logger: logger() })).toEqual({ moved: 0, rewritten: 0, kept: 0 })
    expect(existsSync(join(legacyRoot, 'convA'))).toBe(true)
    expect(dirsOf(db, 'convA')).toEqual([join(legacyRoot, 'convA')])
  })

  it('leaves a legacy folder and its row alone when the target already exists', () => {
    mkdirSync(join(legacyRoot, 'convA'), { recursive: true })
    writeFileSync(join(legacyRoot, 'convA', 'old.txt'), 'legacy')
    mkdirSync(join(newRoot, 'convA'), { recursive: true })
    const db = createMemoryDb()
    makeTable(db)
    insert(db, 'convA', [join(legacyRoot, 'convA')])
    const log = logger()
    expect(migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: log })).toEqual({ moved: 0, rewritten: 0, kept: 1 })
    expect(readFileSync(join(legacyRoot, 'convA', 'old.txt'), 'utf-8')).toBe('legacy')
    expect(dirsOf(db, 'convA')).toEqual([join(legacyRoot, 'convA')])
    expect(log.warn).toHaveBeenCalled()
  })

  it('repoints an auto path whose folder never existed', () => {
    const db = createMemoryDb()
    makeTable(db)
    insert(db, 'ghost', [join(legacyRoot, 'ghost')])
    expect(migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: logger() })).toMatchObject({ rewritten: 1 })
    expect(dirsOf(db, 'ghost')).toEqual([join(newRoot, 'ghost')])
  })

  it('ignores stray files and hidden folders in the legacy root', () => {
    mkdirSync(join(legacyRoot, '.DS_Store_dir'), { recursive: true })
    writeFileSync(join(legacyRoot, 'notes.txt'), 'x')
    const db = createMemoryDb()
    makeTable(db)
    expect(migrateLegacyWorkspaces({ db, legacyRoot, newRoot, logger: logger() })).toEqual({ moved: 0, rewritten: 0, kept: 0 })
    expect(existsSync(join(legacyRoot, 'notes.txt'))).toBe(true)
  })
})

describe('relocateLegacyWorkspaces (boot)', () => {
  const saved = { data: process.env.EYAS_DATA_DIR, ws: process.env.EYAS_WORKSPACES_DIR }
  let dataDir: string

  beforeEach(() => {
    dataDir = join(tmp, 'instance', 'data')
    mkdirSync(join(dataDir, 'workspaces', 'convA'), { recursive: true })
    process.env.EYAS_DATA_DIR = dataDir
    process.env.EYAS_WORKSPACES_DIR = newRoot
  })
  afterEach(() => {
    if (saved.data === undefined) delete process.env.EYAS_DATA_DIR
    else process.env.EYAS_DATA_DIR = saved.data
    if (saved.ws === undefined) delete process.env.EYAS_WORKSPACES_DIR
    else process.env.EYAS_WORKSPACES_DIR = saved.ws
  })

  it('migrates when the database is the instance database', () => {
    mkdirSync(join(dataDir, 'sqlite'), { recursive: true })
    const db = fileDb(join(dataDir, 'sqlite', 'eyas.db'))
    makeTable(db)
    insert(db, 'convA', [join(dataDir, 'workspaces', 'convA')])
    relocateLegacyWorkspaces({ db, logger: logger() as any })
    expect(existsSync(join(newRoot, 'convA'))).toBe(true)
    expect(dirsOf(db, 'convA')).toEqual([join(newRoot, 'convA')])
  })

  it('never moves the instance folders for an in-memory or foreign database', () => {
    const memory = createMemoryDb()
    makeTable(memory)
    relocateLegacyWorkspaces({ db: memory, logger: logger() as any })
    const foreign = fileDb(join(tmp, 'elsewhere.db'))
    makeTable(foreign)
    relocateLegacyWorkspaces({ db: foreign, logger: logger() as any })
    expect(existsSync(join(dataDir, 'workspaces', 'convA'))).toBe(true)
    expect(existsSync(join(newRoot, 'convA'))).toBe(false)
  })

  it('logs and carries on when the conversations table is unreadable', () => {
    mkdirSync(join(dataDir, 'sqlite'), { recursive: true })
    const db = fileDb(join(dataDir, 'sqlite', 'eyas.db'))
    const log = logger()
    expect(() => relocateLegacyWorkspaces({ db, logger: log as any })).not.toThrow()
    expect(log.warn).toHaveBeenCalled()
  })
})
