// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { VaultService } from './vault-service.js'
import type { WikilinkService } from '@shared/wikilinks'
import { extractWikilinks } from './wikilink-parser.js'

export interface VaultIndexerHooks {
  /** Fired after a vault note is (re-)indexed. Use for async work like embedding. */
  onIndexed?: (path: string, content: string) => void
  /** Fired after stale rows are removed. */
  onRemoved?: (path: string) => void
}

/**
 * The scope a note's FOLDER declares: `projects/<id>/…` belongs to that project,
 * `project-types/<id>/…` to that type. Moving a note into the folder is how the
 * product documents scoping, and until now only frontmatter said so — a note
 * filed under `projects/alpha/` with no `project:` key was read as unscoped, and
 * an unscoped note is global, so it surfaced in every other project too.
 *
 * The id is honoured only when this instance actually has that project: the
 * vault also carries `projects/daily/` and `projects/team-sessions/`, which name
 * no project at all, and scoping those to a project that does not exist would
 * hide them from every conversation instead.
 */
function folderScope(path: string): { project?: string; projectType?: string } {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) return {}
  const [folder, id] = parts as [string, string]
  if (folder === 'projects') return { project: id }
  if (folder === 'project-types') return { projectType: id }
  return {}
}

export function createVaultIndexer(db: EyasDb, vault: VaultService, wikilinks: WikilinkService, hooks: VaultIndexerHooks = {}) {
  /** One lookup per distinct id per run: a vault of a thousand notes asks a handful of times. */
  const scopeCache = new Map<string, boolean>()
  const scopeIdExists = (table: 'projects' | 'project_types', id: string): boolean => {
    const key = `${table}:${id}`
    const cached = scopeCache.get(key)
    if (cached !== undefined) return cached
    let found = false
    try {
      const rows =
        table === 'projects'
          ? (db.all(sql`SELECT 1 FROM projects WHERE id = ${id} LIMIT 1`) as unknown[])
          : (db.all(sql`SELECT 1 FROM project_types WHERE id = ${id} LIMIT 1`) as unknown[])
      found = rows.length > 0
    } catch {
      // No board module, or an older schema: unverifiable, so the folder does
      // not scope the note and it stays global exactly as it was.
      found = false
    }
    scopeCache.set(key, found)
    return found
  }

  return {
    indexAll(): number {
      // One pass, one set of answers. The cache exists so a vault of a thousand
      // notes asks about `projects/alpha` once, not a thousand times — but the
      // production indexer is a single long-lived instance, so keeping those
      // answers between passes means a project created after boot never scopes
      // its folder until a restart. That is exactly the D-5 order the docs
      // describe: import a vault whose `projects/<id>/` folders name projects,
      // then create the projects.
      scopeCache.clear()
      const files = vault.listFiles()
      let indexed = 0

      for (const filePath of files) {
        const fileHash = vault.getFileHash(filePath)
        if (!fileHash) continue

        const existing = (db as any).all(
          sql`SELECT file_hash FROM vault_index WHERE path = ${filePath}`
        ) as any[]
        if (existing.length > 0 && existing[0].file_hash === fileHash) continue

        const entry = vault.read(filePath)
        if (!entry) continue

        const now = new Date().toISOString()
        const tags = JSON.stringify(entry.frontmatter.tags)
        const contentText = entry.content
          .replace(/^#{1,6}\s+/gm, '')
          // Strip embeds (![[...]]) and regular wikilinks ([[target|display]]) to plain text.
          .replace(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target, display) => (display ?? target))
          .replace(/```[\s\S]*?```/g, '')
          .trim()

        const existingIndex = (db as any).all(
          sql`SELECT path FROM vault_index WHERE path = ${filePath}`
        ) as any[]

        // Frontmatter first; the folder answers only for a note that declares
        // no scope of its own.
        const folder = folderScope(filePath)
        const projectId =
          entry.frontmatter.project ??
          (folder.project && scopeIdExists('projects', folder.project) ? folder.project : null)
        const projectTypeId =
          entry.frontmatter.projectType ??
          (folder.projectType && scopeIdExists('project_types', folder.projectType)
            ? folder.projectType
            : null)

        if (existingIndex.length > 0) {
          db.run(sql`UPDATE vault_index SET
            title = ${entry.frontmatter.title}, tier = ${entry.frontmatter.tier},
            tags = ${tags}, content_text = ${contentText},
            kind = ${entry.frontmatter.kind ?? null},
            summary = ${entry.frontmatter.summary ?? null},
            project_id = ${projectId},
            project_type_id = ${projectTypeId},
            embedding_hash = ${entry.frontmatter.embedding_hash ?? null},
            file_hash = ${fileHash}, indexed_at = ${now}
            WHERE path = ${filePath}`)
        } else {
          db.run(sql`INSERT INTO vault_index
            (path, title, tier, tags, content_text, kind, summary, project_id, project_type_id, embedding_hash, file_hash, indexed_at)
            VALUES (${filePath}, ${entry.frontmatter.title}, ${entry.frontmatter.tier},
                    ${tags}, ${contentText},
                    ${entry.frontmatter.kind ?? null}, ${entry.frontmatter.summary ?? null},
                    ${projectId},
                    ${projectTypeId},
                    ${entry.frontmatter.embedding_hash ?? null},
                    ${fileHash}, ${now})`)
        }

        // Build graph edges from BOTH inline `[[...]]` wikilinks AND the
        // frontmatter `links:` array — Obsidian users commonly declare links
        // in frontmatter for aliasing / explicit relationships that don't
        // appear inline.
        const extracted = extractWikilinks(entry.content)
        const inlineEntries = extracted.map(w => ({
          targetType: 'vault' as const,
          targetId: w.targetId,
          context: w.context,
        }))
        const frontmatterEntries = (entry.frontmatter.links ?? []).map(l => ({
          targetType: 'vault' as const,
          targetId: String(l).trim(),
          context: `(frontmatter link in ${filePath})`,
        })).filter(e => e.targetId.length > 0)

        // De-duplicate (same target twice from inline + frontmatter is fine,
        // but we keep only the first occurrence to avoid redundant graph edges).
        const seen = new Set<string>()
        const allEntries = [...inlineEntries, ...frontmatterEntries].filter(e => {
          const key = `${e.targetType}:${e.targetId}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        wikilinks.syncLinks('vault', filePath, allEntries)

        try { hooks.onIndexed?.(filePath, contentText) } catch { /* best-effort */ }
        indexed++
      }

      return indexed
    },

    removeStale() {
      const files = new Set(vault.listFiles())
      const indexed = (db as any).all(sql`SELECT path FROM vault_index`) as any[]
      for (const row of indexed) {
        if (!files.has(row.path)) {
          db.run(sql`DELETE FROM vault_index WHERE path = ${row.path}`)
          wikilinks.removeSource('vault', row.path)
          try { hooks.onRemoved?.(row.path) } catch { /* best-effort */ }
        }
      }
    },
  }
}

export type VaultIndexer = ReturnType<typeof createVaultIndexer>
