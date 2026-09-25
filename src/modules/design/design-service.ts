// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-service.ts
//
// CRUD over the designs table plus the file tree behind it.
//
// The rule that shapes everything here: NOTHING becomes a version without
// passing validateCanvas. A design edit arrives from a human editor, an
// import, or any of three AI executor tiers, and the gate is the only reason
// the feature behaves the same whichever it was.
//
// A rejected write leaves the tree exactly as it was — the candidate files are
// validated in memory first, and only then written.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import { CANVAS_FILE, ENTRY_ARTBOARD, type CanvasManifest } from './canvas-schema.js'
import { validateCanvas, describeIssues, type ValidationResult } from './dc-validate.js'
import { artboardFiles, type DesignStore } from './design-store.js'
import { DESIGN_KINDS, type Design, type DesignKind, type DesignOrigin, type DesignRow, type DesignVersion } from './types.js'

export class DesignValidationError extends Error {
  constructor(message: string, readonly result: ValidationResult) { super(message) }
}
export class DesignNotFoundError extends Error {}

const STARTER_ARTBOARD = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    a { color: #1f4ed8; } a:hover { color: #16389c; }
  </style>
</helmet>
<div style="display: flex; flex-direction: column; gap: 16px; padding: 48px">
  <h1 style="margin: 0; font-size: 40px; line-height: 1.1">Untitled artboard</h1>
  <p style="margin: 0; max-width: 52ch; color: #5b6472">Replace this with the design.</p>
</div>
</x-dc>
</body>
</html>
`

function slugify(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
  return base.slice(0, 60) || 'design'
}

function toRow(raw: any): DesignRow {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(raw.tags ?? '[]')
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string')
  } catch { /* a hand-edited tags column must not take the row down */ }
  return {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    kind: raw.kind as DesignKind,
    tags,
    currentVersion: raw.current_version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export interface DesignLinkSummary {
  total: number
  /** Owning module → how many owners in it hold this design. */
  byModule: Record<string, number>
}

export interface CreateDesignInput {
  title: string
  kind?: DesignKind
  tags?: string[]
  /** Full files record. Omitted means a one-artboard starter canvas. */
  files?: Record<string, string>
  origin?: DesignOrigin
  actor?: string
}

export interface DesignService {
  create(input: CreateDesignInput): Design
  get(id: string): Design | null
  getBySlug(slug: string): Design | null
  list(filter?: { kind?: DesignKind }): DesignRow[]
  update(id: string, patch: { title?: string; kind?: DesignKind; tags?: string[] }): Design
  /** Replace the whole files record. The gate runs before anything is written. */
  writeFiles(id: string, files: Record<string, string>, opts?: { actor?: string; note?: string; origin?: DesignOrigin }): Design
  writeFile(id: string, path: string, content: string, opts?: { actor?: string; note?: string; origin?: DesignOrigin }): Design
  deleteFile(id: string, path: string, opts?: { actor?: string; note?: string }): Design
  versions(id: string): DesignVersion[]
  restore(id: string, version: number, actor?: string): Design
  remove(id: string): void
  link(designId: string, ownerModule: string, ownerId: string, source?: string): void
  unlink(designId: string, ownerModule: string, ownerId: string): void
  linkedTo(ownerModule: string, ownerId: string): DesignRow[]
  /**
   * Who holds on to this design, counted per owning module. `linkedTo` answers
   * the other direction and cannot serve a delete confirmation, which has to
   * name what goes with the design — attachments are the part a person cannot
   * see from the design's own page.
   */
  linkSummary(designId: string): DesignLinkSummary
  /**
   * Copy a project's designs onto a conversation joining it, and return how
   * many were copied. Additive and idempotent: it never removes a design
   * somebody attached to the conversation deliberately, so moving between
   * projects adds rather than replaces.
   *
   * This is the same shape as `indexedSources` and `workingDirectories` — the
   * project's setting SEEDS the conversation, which then owns it. Nothing
   * resolves the project again at read time.
   */
  adoptProjectDesigns(conversationId: string, projectId: string): number
  /** Validate a candidate files record without touching anything. */
  check(files: Record<string, string>): ValidationResult
}

export function createDesignService(db: EyasDb, store: DesignStore): DesignService {
  function rowOf(id: string): DesignRow {
    const rows = db.all(sql`SELECT * FROM designs WHERE id = ${id}`) as any[]
    if (rows.length === 0) throw new DesignNotFoundError(`design not found: ${id}`)
    return toRow(rows[0])
  }

  function readManifest(files: Record<string, string>): CanvasManifest {
    const raw = files[CANVAS_FILE]
    if (raw === undefined) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed as CanvasManifest : {}
    } catch {
      return {}
    }
  }

  function hydrate(row: DesignRow): Design {
    const files = store.readAll(row.id)
    return { ...row, files, manifest: readManifest(files), artboards: artboardFiles(files) }
  }

  function commit(id: string, origin: DesignOrigin, actor?: string, note?: string): DesignRow {
    const current = rowOf(id)
    const next = current.currentVersion + 1
    store.snapshot(id, next)
    db.run(sql`INSERT INTO design_versions (design_id, version, origin, created_by, change_note)
      VALUES (${id}, ${next}, ${origin}, ${actor ?? null}, ${note ?? null})`)
    db.run(sql`UPDATE designs SET current_version = ${next}, updated_at = datetime('now') WHERE id = ${id}`)
    return rowOf(id)
  }

  function uniqueSlug(title: string): string {
    const base = slugify(title)
    let candidate = base
    for (let n = 2; n < 200; n++) {
      if ((db.all(sql`SELECT 1 FROM designs WHERE slug = ${candidate}`) as any[]).length === 0) return candidate
      candidate = `${base}-${n}`
    }
    return `${base}-${generateId().slice(0, 8).toLowerCase()}`
  }

  /** Write a validated files record over the live tree, removing what is gone. */
  function replaceTree(id: string, files: Record<string, string>): void {
    for (const existing of store.list(id)) {
      if (!(existing in files)) store.remove(id, existing)
    }
    for (const [path, content] of Object.entries(files)) store.write(id, path, content)
  }

  function gate(files: Record<string, string>): void {
    const result = validateCanvas(files)
    if (!result.ok) throw new DesignValidationError(describeIssues(result), result)
  }

  return {
    check: validateCanvas,

    create(input) {
      const files = input.files ?? { [ENTRY_ARTBOARD]: STARTER_ARTBOARD }
      gate(files)

      const id = generateId()
      const kind = input.kind && DESIGN_KINDS.includes(input.kind) ? input.kind : 'freeform'
      db.run(sql`INSERT INTO designs (id, title, slug, kind, tags, current_version)
        VALUES (${id}, ${input.title}, ${uniqueSlug(input.title)}, ${kind}, ${JSON.stringify(input.tags ?? [])}, 1)`)

      for (const [path, content] of Object.entries(files)) store.write(id, path, content)
      store.snapshot(id, 1)
      db.run(sql`INSERT INTO design_versions (design_id, version, origin, created_by, change_note)
        VALUES (${id}, 1, ${input.origin ?? 'manual'}, ${input.actor ?? null}, 'created')`)

      return hydrate(rowOf(id))
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM designs WHERE id = ${id}`) as any[]
      return rows.length ? hydrate(toRow(rows[0])) : null
    },

    getBySlug(slug) {
      const rows = db.all(sql`SELECT * FROM designs WHERE slug = ${slug}`) as any[]
      return rows.length ? hydrate(toRow(rows[0])) : null
    },

    list(filter) {
      const rows = db.all(sql`SELECT * FROM designs ORDER BY updated_at DESC`) as any[]
      return rows.map(toRow).filter((d) => !filter?.kind || d.kind === filter.kind)
    },

    update(id, patch) {
      rowOf(id)
      if (patch.title !== undefined) db.run(sql`UPDATE designs SET title = ${patch.title} WHERE id = ${id}`)
      if (patch.kind !== undefined) db.run(sql`UPDATE designs SET kind = ${patch.kind} WHERE id = ${id}`)
      if (patch.tags !== undefined) db.run(sql`UPDATE designs SET tags = ${JSON.stringify(patch.tags)} WHERE id = ${id}`)
      db.run(sql`UPDATE designs SET updated_at = datetime('now') WHERE id = ${id}`)
      return hydrate(rowOf(id))
    },

    writeFiles(id, files, opts) {
      rowOf(id)
      // Validate the CANDIDATE before touching the tree: a failed edit must
      // leave the previous version intact and openable.
      gate(files)
      replaceTree(id, files)
      return hydrate(commit(id, opts?.origin ?? 'manual', opts?.actor, opts?.note ?? 'files replaced'))
    },

    writeFile(id, path, content, opts) {
      rowOf(id)
      const next = { ...store.readAll(id), [path]: content }
      gate(next)
      store.write(id, path, content)
      return hydrate(commit(id, opts?.origin ?? 'manual', opts?.actor, opts?.note ?? `wrote ${path}`))
    },

    deleteFile(id, path, opts) {
      rowOf(id)
      const next = { ...store.readAll(id) }
      delete next[path]
      gate(next)
      store.remove(id, path)
      return hydrate(commit(id, 'manual', opts?.actor, opts?.note ?? `deleted ${path}`))
    },

    versions(id) {
      return (db.all(sql`SELECT * FROM design_versions WHERE design_id = ${id} ORDER BY version`) as any[]).map((r) => ({
        id: r.id, designId: r.design_id, version: r.version, origin: r.origin as DesignOrigin,
        createdAt: r.created_at, createdBy: r.created_by ?? null, changeNote: r.change_note ?? null,
      }))
    },

    restore(id, version, actor) {
      rowOf(id)
      store.restore(id, version)
      return hydrate(commit(id, 'manual', actor, `restored version ${version}`))
    },

    remove(id) {
      db.run(sql`DELETE FROM design_versions WHERE design_id = ${id}`)
      db.run(sql`DELETE FROM design_links WHERE design_id = ${id}`)
      db.run(sql`DELETE FROM designs WHERE id = ${id}`)
      store.destroy(id)
    },

    link(designId, ownerModule, ownerId, source = 'user') {
      db.run(sql`INSERT OR IGNORE INTO design_links (design_id, owner_module, owner_id, source)
        VALUES (${designId}, ${ownerModule}, ${ownerId}, ${source})`)
    },

    unlink(designId, ownerModule, ownerId) {
      db.run(sql`DELETE FROM design_links WHERE design_id = ${designId} AND owner_module = ${ownerModule} AND owner_id = ${ownerId}`)
    },

    adoptProjectDesigns(conversationId, projectId) {
      const fromProject = db.all(sql`SELECT design_id FROM design_links
        WHERE owner_module = 'projects' AND owner_id = ${projectId}`) as Array<{ design_id: string }>
      let copied = 0
      for (const row of fromProject) {
        db.run(sql`INSERT OR IGNORE INTO design_links (design_id, owner_module, owner_id, source)
          VALUES (${row.design_id}, 'conversations', ${conversationId}, 'project')`)
        copied++
      }
      return copied
    },

    linkSummary(designId) {
      const rows = db.all(sql`SELECT owner_module, COUNT(*) AS n FROM design_links
        WHERE design_id = ${designId} GROUP BY owner_module`) as Array<{ owner_module: string; n: number }>
      const byModule: Record<string, number> = {}
      let total = 0
      for (const row of rows) {
        const n = Number(row.n)
        byModule[row.owner_module] = n
        total += n
      }
      return { total, byModule }
    },

    linkedTo(ownerModule, ownerId) {
      return (db.all(sql`SELECT d.* FROM designs d
        JOIN design_links l ON l.design_id = d.id
        WHERE l.owner_module = ${ownerModule} AND l.owner_id = ${ownerId}
        ORDER BY d.updated_at DESC`) as any[]).map(toRow)
    },
  }
}
