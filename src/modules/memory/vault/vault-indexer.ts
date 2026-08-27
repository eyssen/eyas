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

export function createVaultIndexer(db: EyasDb, vault: VaultService, wikilinks: WikilinkService, hooks: VaultIndexerHooks = {}) {
  return {
    indexAll(): number {
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

        if (existingIndex.length > 0) {
          db.run(sql`UPDATE vault_index SET
            title = ${entry.frontmatter.title}, tier = ${entry.frontmatter.tier},
            tags = ${tags}, content_text = ${contentText},
            kind = ${entry.frontmatter.kind ?? null},
            summary = ${entry.frontmatter.summary ?? null},
            embedding_hash = ${entry.frontmatter.embedding_hash ?? null},
            file_hash = ${fileHash}, indexed_at = ${now}
            WHERE path = ${filePath}`)
        } else {
          db.run(sql`INSERT INTO vault_index
            (path, title, tier, tags, content_text, kind, summary, embedding_hash, file_hash, indexed_at)
            VALUES (${filePath}, ${entry.frontmatter.title}, ${entry.frontmatter.tier},
                    ${tags}, ${contentText},
                    ${entry.frontmatter.kind ?? null}, ${entry.frontmatter.summary ?? null},
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
