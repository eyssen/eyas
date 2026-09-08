// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/http-secrets.ts
//
// D-7 on the HTTP surface, keyed on the CALLER rather than on the route.
//
// The recall gate (`memory.recall.includeSecrets`) decides what a MODEL may be
// handed. It says nothing about a person reading their own vault, which is why
// the direct read routes were originally left alone. That reasoning does not
// survive contact with the permission table: `read` on MemoryEntry is granted
// to the `user` AND `agent` roles (`permissions/roles.ts`), and an agent
// principal is a model with credentials. So every route that hands back a
// stored body — or an index of which stored bodies exist — has to ask who is
// calling, not which route it is.
//
// The right is `delete` on MemoryEntry, held by `owner` alone in this build:
// the same right that guards `GET /memory/search?includeSecrets=true`, so the
// module has one boundary rather than one per door.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { hasSecretsTag, SECRETS_TAG } from './memory-index.js'

/** The one caller test. Anything that cannot produce an ability is not the owner. */
export function callerMaySeeSecrets(c: unknown): boolean {
  try {
    const ability = (c as { get?: (k: string) => unknown }).get?.('ability') as
      { can?: (action: string, subject: string) => boolean } | undefined
    return ability?.can?.('delete', 'MemoryEntry') === true
  } catch {
    return false
  }
}

export interface VaultTagSource {
  db?: EyasDb
  vault: { read(path: string): { frontmatter: { tags?: unknown } } | null }
}

/**
 * Paths of every flagged note. Prefers `vault_index`, which is one query; falls
 * back to reading the files when the routes were mounted without a database.
 * A path whose tags cannot be read at all counts as flagged: on this side the
 * cost of being wrong is a note the owner can still open by name, not a
 * credential handed to an agent.
 */
export function flaggedVaultPaths(deps: VaultTagSource, paths: string[]): Set<string> {
  const flagged = new Set<string>()
  if (deps.db) {
    try {
      const rows = (deps.db as any).all(sql`SELECT path, tags FROM vault_index
        WHERE tags LIKE ${`%"${SECRETS_TAG}"%`}`) as Array<{ path: string; tags: string | null }>
      for (const row of rows) if (hasSecretsTag(row.tags)) flagged.add(row.path)
      // A-42 / N10. The lists these callers pass come from `vault.listFiles()`
      // — the DISK — while the query above answers from `vault_index`, so a
      // note written a moment ago and not yet indexed produced no row and read
      // as unflagged. That window is real: an import writes the files first and
      // the indexer follows, and the watcher that would close it has a path bug
      // of its own (A-55). No body leaks (the by-id doors read the frontmatter
      // and 404), but the PATH was advertised, and `contains-secrets` is itself
      // a tag one can list — a directory of what to go and read.
      //
      // So a path the index does not know about is decided from the file's own
      // frontmatter, the way the graph route already does it.
      const known = new Set<string>()
      for (const row of (deps.db as any).all(sql`SELECT path FROM vault_index`) as Array<{ path: string }>) {
        known.add(row.path)
      }
      for (const path of paths) {
        if (known.has(path) || flagged.has(path)) continue
        try {
          const entry = deps.vault.read(path)
          if (!entry) continue
          if (hasSecretsTag(entry.frontmatter.tags as string[] | undefined)) flagged.add(path)
        } catch {
          flagged.add(path)
        }
      }
      return flagged
    } catch { /* fall through to the file read */ }
  }
  for (const path of paths) {
    try {
      const entry = deps.vault.read(path)
      if (!entry) continue
      if (hasSecretsTag(entry.frontmatter.tags as string[] | undefined)) flagged.add(path)
    } catch {
      flagged.add(path)
    }
  }
  return flagged
}
