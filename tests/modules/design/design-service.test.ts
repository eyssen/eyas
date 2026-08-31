// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore, imageDataUris } from '@modules/design/design-store'
import { createDesignService, DesignValidationError, DesignNotFoundError, type DesignService } from '@modules/design/design-service'

let root: string
let db: any
let svc: DesignService

const artboard = (body = '<p>hi</p>') =>
  `<x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-design-'))
  db = createMemoryDb()
  createDesignTables(db)
  svc = createDesignService(db, createDesignStore(join(root, 'designs')))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('create', () => {
  it('seeds a starter canvas that passes its own gate', () => {
    const d = svc.create({ title: 'Landing' })
    expect(d.currentVersion).toBe(1)
    expect(d.artboards).toEqual(['Main.dc.html'])
    expect(svc.check(d.files).ok).toBe(true)
  })

  it('accepts a supplied files record', () => {
    const d = svc.create({
      title: 'Flow',
      files: {
        'Main.dc.html': artboard(),
        'Pricing.dc.html': artboard('<b>p</b>'),
        'canvas.json': JSON.stringify({ artboards: [
          { file: 'Main.dc.html', x: 0, y: 0, w: 800, h: 600 },
          { file: 'Pricing.dc.html', x: 900, y: 0, w: 800, h: 600 },
        ] }),
      },
    })
    expect(d.artboards).toEqual(['Main.dc.html', 'Pricing.dc.html'])
    expect(d.manifest.artboards).toHaveLength(2)
  })

  it('refuses an invalid canvas and writes nothing', () => {
    expect(() => svc.create({ title: 'Bad', files: { 'Main.dc.html': '<div>no x-dc</div>' } }))
      .toThrow(DesignValidationError)
    expect(svc.list()).toEqual([])
  })

  it('de-duplicates slugs', () => {
    expect(svc.create({ title: 'Same' }).slug).toBe('same')
    expect(svc.create({ title: 'Same' }).slug).toBe('same-2')
  })
})

describe('the gate on every write', () => {
  it('rejects a file write that would break the canvas, leaving the version intact', () => {
    const d = svc.create({ title: 'X' })
    expect(() => svc.writeFile(d.id, 'Broken.dc.html', '<div>no root</div>')).toThrow(DesignValidationError)
    const after = svc.get(d.id)!
    expect(after.currentVersion).toBe(1)
    expect(after.artboards).toEqual(['Main.dc.html'])
  })

  it('rejects a manifest that references a missing artboard', () => {
    const d = svc.create({ title: 'X' })
    expect(() => svc.writeFile(d.id, 'canvas.json', JSON.stringify({ artboards: [{ file: 'Ghost.dc.html', x: 0, y: 0, w: 1, h: 1 }] })))
      .toThrow(/not a files entry/)
  })

  it('rejects deleting the last artboard', () => {
    const d = svc.create({ title: 'X' })
    expect(() => svc.deleteFile(d.id, 'Main.dc.html')).toThrow(DesignValidationError)
    expect(svc.get(d.id)!.artboards).toEqual(['Main.dc.html'])
  })

  it('surfaces the issues on the error for retry feedback', () => {
    const d = svc.create({ title: 'X' })
    try {
      svc.writeFile(d.id, 'Main.dc.html', artboard('<i style="color: {{x}} ? a : b">t</i>'))
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DesignValidationError)
      expect((err as DesignValidationError).result.errors.map((e) => e.code)).toContain('style-ternary')
    }
  })

  it('accepts a valid replacement of the whole tree', () => {
    const d = svc.create({ title: 'X' })
    const next = svc.writeFiles(d.id, { 'Main.dc.html': artboard('<b>new</b>'), 'Hero.dc.html': artboard() }, { origin: 'ai' })
    expect(next.currentVersion).toBe(2)
    expect(next.artboards).toEqual(['Hero.dc.html', 'Main.dc.html'])
    expect(svc.versions(d.id).at(-1)!.origin).toBe('ai')
  })

  it('removes files that are absent from a replacement record', () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': artboard(), 'Old.dc.html': artboard() } })
    const next = svc.writeFiles(d.id, { 'Main.dc.html': artboard() })
    expect(next.artboards).toEqual(['Main.dc.html'])
    expect(next.files['Old.dc.html']).toBeUndefined()
  })
})

describe('versioning', () => {
  it('appends versions and records origin, actor and note', () => {
    const d = svc.create({ title: 'X', actor: 'creator' })
    svc.writeFile(d.id, 'Hero.dc.html', artboard(), { actor: 'ed', note: 'add hero', origin: 'ai' })
    const vs = svc.versions(d.id)
    expect(vs.map((v) => v.version)).toEqual([1, 2])
    expect(vs[1]).toMatchObject({ createdBy: 'ed', changeNote: 'add hero', origin: 'ai' })
  })

  it('restores forward as a new version', () => {
    const d = svc.create({ title: 'X' })
    svc.writeFile(d.id, 'Hero.dc.html', artboard())      // v2
    svc.deleteFile(d.id, 'Hero.dc.html')                  // v3
    const restored = svc.restore(d.id, 2)
    expect(restored.currentVersion).toBe(4)
    expect(restored.artboards).toContain('Hero.dc.html')
  })
})

describe('metadata and links', () => {
  it('updates metadata without bumping the content version', () => {
    const d = svc.create({ title: 'X' })
    const updated = svc.update(d.id, { title: 'Y', kind: 'landing', tags: ['a'] })
    expect(updated).toMatchObject({ title: 'Y', kind: 'landing' })
    expect(updated.tags).toEqual(['a'])
    expect(updated.currentVersion).toBe(1)
  })

  it('filters the list by kind', () => {
    svc.update(svc.create({ title: 'A' }).id, { kind: 'print' })
    svc.create({ title: 'B' })
    expect(svc.list({ kind: 'print' }).map((d) => d.title)).toEqual(['A'])
    expect(svc.list().map((d) => d.title).sort()).toEqual(['A', 'B'])
  })

  it('still works against a table that predates the status removal', () => {
    // Existing installs keep the inert `status` column: it is NOT NULL with a
    // default, so an INSERT that omits it is fine, and nothing reads it back.
    // Dropping it would be a table rebuild for no gain — but that only holds
    // as long as the default is there, so this is the test that says so.
    const legacyDb = createMemoryDb()
    legacyDb.run(sql`CREATE TABLE designs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'freeform',
      status TEXT NOT NULL DEFAULT 'draft',
      design_system_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    legacyDb.run(sql`CREATE TABLE design_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, design_id TEXT NOT NULL, version INTEGER NOT NULL,
      origin TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT, change_note TEXT, UNIQUE(design_id, version))`)
    legacyDb.run(sql`CREATE TABLE design_links (
      design_id TEXT NOT NULL, owner_module TEXT NOT NULL, owner_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(design_id, owner_module, owner_id))`)

    const legacy = createDesignService(legacyDb, createDesignStore(join(root, 'legacy')))
    const created = legacy.create({ title: 'Old install' })
    expect(created.title).toBe('Old install')
    expect(created).not.toHaveProperty('status')
    expect(legacy.update(created.id, { title: 'Renamed' }).title).toBe('Renamed')
    expect(legacy.list().map((d) => d.title)).toEqual(['Renamed'])
  })

  it('carries no status field — a design is a document, not a workflow item', () => {
    // Removed deliberately: the column existed, the badge rendered it, and
    // nothing anywhere read it. Nothing gated on it, nothing filtered by it in
    // the UI, and it could not even be changed. This test is here so it does
    // not quietly grow back.
    expect(svc.create({ title: 'X' })).not.toHaveProperty('status')
  })

  it('links to an owner, lists by owner and unlinks', () => {
    const d = svc.create({ title: 'X' })
    svc.link(d.id, 'conversations', 'c1')
    svc.link(d.id, 'conversations', 'c1') // idempotent
    expect(svc.linkedTo('conversations', 'c1').map((r) => r.id)).toEqual([d.id])
    svc.unlink(d.id, 'conversations', 'c1')
    expect(svc.linkedTo('conversations', 'c1')).toEqual([])
  })

  it('summarises who links to a design, so a delete can say what it takes with it', () => {
    const d = svc.create({ title: 'Shared' })
    expect(svc.linkSummary(d.id)).toEqual({ total: 0, byModule: {} })

    svc.link(d.id, 'conversations', 'c1')
    svc.link(d.id, 'conversations', 'c2')
    svc.link(d.id, 'projects', 'p1')
    svc.link(d.id, 'conversations', 'c1') // idempotent, not a second count

    expect(svc.linkSummary(d.id)).toEqual({ total: 3, byModule: { conversations: 2, projects: 1 } })
  })

  it('removing a design clears its versions and links', () => {
    const d = svc.create({ title: 'X' })
    svc.link(d.id, 'conversations', 'c1')
    svc.remove(d.id)
    expect(svc.get(d.id)).toBeNull()
    expect(svc.versions(d.id)).toEqual([])
    expect(svc.linkedTo('conversations', 'c1')).toEqual([])
  })

  it('throws for an unknown id on mutation and returns null from get', () => {
    expect(svc.get('ghost')).toBeNull()
    expect(() => svc.update('ghost', { title: 'x' })).toThrow(DesignNotFoundError)
  })
})

describe('imageDataUris', () => {
  it('wraps bare base64 into a data URI by extension', () => {
    expect(imageDataUris({ 'logo.png': 'AAA', 'Main.dc.html': artboard() }))
      .toEqual({ 'logo.png': 'data:image/png;base64,AAA' })
  })

  it('strips a stored data: prefix rather than double-wrapping', () => {
    expect(imageDataUris({ 'a.jpg': 'data:image/jpeg;base64,BBB' })['a.jpg'])
      .toBe('data:image/jpeg;base64,BBB')
  })
})

describe('adoptProjectDesigns', () => {
  it('copies the project designs onto the conversation as its own links', () => {
    // The house pattern (indexedSources, workingDirectories): a project's
    // setting seeds the conversation when it joins, and the conversation owns
    // it from then on.
    const a = svc.create({ title: 'A', files: { 'Main.dc.html': artboard() } })
    const b = svc.create({ title: 'B', files: { 'Main.dc.html': artboard() } })
    svc.link(a.id, 'projects', 'proj-1')
    svc.link(b.id, 'projects', 'proj-1')

    expect(svc.adoptProjectDesigns('conv-1', 'proj-1')).toBe(2)
    expect(svc.linkedTo('conversations', 'conv-1').map((d) => d.title).sort()).toEqual(['A', 'B'])
  })

  it('copies nothing when the project has none — not a clear-out', () => {
    const own = svc.create({ title: 'Mine', files: { 'Main.dc.html': artboard() } })
    svc.link(own.id, 'conversations', 'conv-1')

    expect(svc.adoptProjectDesigns('conv-1', 'proj-empty')).toBe(0)
    expect(svc.linkedTo('conversations', 'conv-1').map((d) => d.title)).toEqual(['Mine'])
  })

  it('never removes what the conversation already had', () => {
    // Moving between projects adds; it does not throw away a design somebody
    // deliberately attached to this conversation.
    const mine = svc.create({ title: 'Mine', files: { 'Main.dc.html': artboard() } })
    const theirs = svc.create({ title: 'Theirs', files: { 'Main.dc.html': artboard() } })
    svc.link(mine.id, 'conversations', 'conv-1')
    svc.link(theirs.id, 'projects', 'proj-1')

    svc.adoptProjectDesigns('conv-1', 'proj-1')
    expect(svc.linkedTo('conversations', 'conv-1').map((d) => d.title).sort()).toEqual(['Mine', 'Theirs'])
  })

  it('is idempotent', () => {
    const a = svc.create({ title: 'A', files: { 'Main.dc.html': artboard() } })
    svc.link(a.id, 'projects', 'proj-1')
    svc.adoptProjectDesigns('conv-1', 'proj-1')
    svc.adoptProjectDesigns('conv-1', 'proj-1')
    expect(svc.linkedTo('conversations', 'conv-1')).toHaveLength(1)
  })

  it('marks the copies so their origin is still legible', () => {
    const a = svc.create({ title: 'A', files: { 'Main.dc.html': artboard() } })
    svc.link(a.id, 'projects', 'proj-1')
    svc.adoptProjectDesigns('conv-1', 'proj-1')
    const rows = db.all(sql`SELECT source FROM design_links WHERE owner_module = 'conversations'`) as any[]
    expect(rows[0].source).toBe('project')
  })
})
