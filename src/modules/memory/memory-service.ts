// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { WorkingMemoryService } from './tiers/working-memory.js'
import type { EpisodicMemoryService } from './tiers/episodic-memory.js'
import type { ArchiveMemoryService } from './tiers/archive-memory.js'
import type { VaultService } from './vault/vault-service.js'
import type { VaultIndexer } from './vault/vault-indexer.js'
import type { WikilinkService } from '@shared/wikilinks'
import type { MemorySearchQuery, MemorySearchResult } from './types.js'
import { escapeFtsQuery } from './schema.js'
import { computeQueryWeights, computeRRF } from './search/hybrid-search.js'
import { createGraphSearch } from './search/graph-search.js'
import { resolveProjectTypeId, vaultNoteInScope } from './memory-index.js'

interface MemoryServiceDeps {
  working: WorkingMemoryService
  episodic: EpisodicMemoryService
  archive: ArchiveMemoryService
  vault: VaultService
  indexer: VaultIndexer
  wikilinks?: WikilinkService
  db?: EyasDb
  embeddings?: {
    searchEpisodic(query: string, limit: number, agentId?: string): Promise<Array<{ id: string; score: number }>>
    searchVault(query: string, limit: number): Promise<Array<{ path: string; score: number }>>
  }
}

export interface MemorySearchOptions extends MemorySearchQuery {
  agentId?: string
  includeShared?: boolean
}

export function createMemoryService(deps: MemoryServiceDeps) {
  const graphSearch = deps.wikilinks ? createGraphSearch(deps.wikilinks) : null

  function safeAll<T>(stmt: ReturnType<typeof sql>): T[] {
    try {
      return (deps.db as any)?.all(stmt) as T[] ?? []
    } catch {
      return []
    }
  }

  function ftsEpisodic(query: string, limit: number, agentId?: string, includeShared = true): Array<{ id: string; score: number; content: string; salience: number; tags: string[]; sourceType: string; agentId: string | null }> {
    if (!deps.db) return []
    const fts = escapeFtsQuery(query)
    // bm25() returns negative values where lower = better; flip sign so higher = better.
    const rows = safeAll<any>(sql`
      SELECT em.id AS id, em.content AS content, em.salience AS salience,
             em.tags AS tags, em.source_type AS source_type, em.agent_id AS agent_id,
             -bm25(episodic_fts) AS fts_score
      FROM episodic_fts
      JOIN episodic_memories em ON em.rowid = episodic_fts.rowid
      WHERE episodic_fts MATCH ${fts}
        AND em.valid_until IS NULL
      ORDER BY fts_score DESC
      LIMIT ${limit * 2}
    `)
    const filtered = agentId
      ? rows.filter(r => includeShared ? (r.agent_id === agentId || r.agent_id === null) : r.agent_id === agentId)
      : rows
    return filtered.slice(0, limit).map(r => ({
      id: r.id,
      score: Number(r.fts_score) || 0,
      content: r.content,
      salience: Number(r.salience) || 0,
      tags: r.tags ? JSON.parse(r.tags) : [],
      sourceType: r.source_type,
      agentId: r.agent_id,
    }))
  }

  function ftsVault(query: string, limit: number): Array<{
    path: string; score: number; title: string; tier: string; tags: string[]; content: string
    kind: string | null; project_id: string | null; project_type_id: string | null
  }> {
    if (!deps.db) return []
    const fts = escapeFtsQuery(query)
    const rows = safeAll<any>(sql`
      SELECT vi.path AS path, vi.title AS title, vi.tier AS tier,
             vi.tags AS tags, vi.content_text AS content_text,
             vi.kind AS kind, vi.project_id AS project_id, vi.project_type_id AS project_type_id,
             -bm25(vault_fts) AS fts_score
      FROM vault_fts
      JOIN vault_index vi ON vi.rowid = vault_fts.rowid
      WHERE vault_fts MATCH ${fts}
      ORDER BY fts_score DESC
      LIMIT ${limit}
    `)
    return rows.map(r => ({
      path: r.path,
      score: Number(r.fts_score) || 0,
      title: r.title,
      tier: r.tier,
      tags: r.tags ? JSON.parse(r.tags) : [],
      content: r.content_text,
      kind: r.kind ?? null,
      project_id: r.project_id ?? null,
      project_type_id: r.project_type_id ?? null,
    }))
  }

  function ftsArchive(query: string, limit: number): Array<{ id: string; score: number; content: string; tags: string[] }> {
    if (!deps.db) return []
    const fts = escapeFtsQuery(query)
    // Prefer FTS5 MATCH; fall back to LIKE if archive_fts is missing (older DBs).
    try {
      const rows = safeAll<any>(sql`
        SELECT am.id AS id, am.content AS content, am.tags AS tags,
               -bm25(archive_fts) AS fts_score
        FROM archive_fts
        JOIN archive_memories am ON am.rowid = archive_fts.rowid
        WHERE archive_fts MATCH ${fts}
        ORDER BY fts_score DESC
        LIMIT ${sql.raw(String(Math.max(1, Math.floor(limit))))}
      `)
      if (rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          // Archive is lower priority than live episodic; scale score down.
          score: Math.max(0.01, (Number(r.fts_score) || 0) * 0.3),
          content: r.content,
          tags: r.tags ? JSON.parse(r.tags) : [],
        }))
      }
    } catch { /* fall back below */ }
    const pattern = `%${query.replace(/[%_]/g, m => '\\' + m)}%`
    const rows = safeAll<any>(sql`
      SELECT id, content, tags FROM archive_memories
      WHERE content LIKE ${pattern} ESCAPE '\\'
      ORDER BY archived_at DESC LIMIT ${sql.raw(String(Math.max(1, Math.floor(limit))))}
    `)
    return rows.map(r => ({
      id: r.id,
      score: 0.1,
      content: r.content,
      tags: r.tags ? JSON.parse(r.tags) : [],
    }))
  }

  return {
    working: deps.working,
    episodic: deps.episodic,
    archive: deps.archive,
    vault: deps.vault,
    indexer: deps.indexer,

    /**
     * Hybrid search across all memory tiers: FTS5 (episodic + vault) + optional
     * vector search + wikilink graph boosts, fused with Reciprocal Rank Fusion.
     */
    async search(query: MemorySearchOptions): Promise<MemorySearchResult[]> {
      const tiers = query.tiers ?? ['episodic', 'semantic', 'procedural', 'archive']
      const limit = query.limit ?? 20
      const wantEpisodic = tiers.includes('episodic')
      const wantVault = tiers.includes('semantic') || tiers.includes('procedural')
      const wantArchive = tiers.includes('archive')
      const weights = computeQueryWeights(query.query)
      const projectId = query.projectId ?? null
      const projectTypeId = query.projectTypeId !== undefined
        ? query.projectTypeId ?? null
        : (deps.db ? resolveProjectTypeId(deps.db, projectId) : null)
      const noteInScope = (row: {
        kind?: string | null; tier: string
        project_id?: string | null; project_type_id?: string | null
      }) => vaultNoteInScope(row, { projectId, projectTypeId, scope: query.scope })

      // Token-budget limits per source — pull 2× so RRF has headroom.
      const perSource = Math.max(10, limit * 2)

      // --- FTS ---
      const episodicFtsRaw = wantEpisodic ? ftsEpisodic(query.query, perSource, query.agentId, query.includeShared ?? true) : []
      const vaultFtsRaw = wantVault ? ftsVault(query.query, perSource) : []
      const archiveRaw = wantArchive ? ftsArchive(query.query, perSource) : []

      // Filter vault by requested tiers (semantic/procedural), then by note scope.
      const vaultFiltered = vaultFtsRaw
        .filter(v => tiers.includes(v.tier as any))
        .filter(noteInScope)

      // --- Vector (optional, via embeddings provider) ---
      let episodicVecRaw: Array<{ id: string; score: number }> = []
      let vaultVecRaw: Array<{ path: string; score: number }> = []
      if (deps.embeddings) {
        try {
          if (wantEpisodic) episodicVecRaw = await deps.embeddings.searchEpisodic(query.query, perSource, query.agentId)
          if (wantVault) vaultVecRaw = await deps.embeddings.searchVault(query.query, perSource)
        } catch { /* embeddings unavailable */ }
        if (query.scope === 'current' && vaultVecRaw.length > 0) {
          const known = new Map(vaultFtsRaw.map(v => [v.path, v]))
          vaultVecRaw = vaultVecRaw.filter(v => {
            const row = known.get(v.path)
            if (row) return noteInScope(row)
            const found = safeAll<{
              kind: string | null; tier: string
              project_id: string | null; project_type_id: string | null
            }>(sql`SELECT kind, tier, project_id, project_type_id FROM vault_index WHERE path = ${v.path}`)[0]
            return found ? noteInScope(found) : true
          })
        }
      }

      // --- Content map for hydration ---
      const contentMap = new Map<string, { content: string; source: MemorySearchResult['source']; metadata: Record<string, unknown> }>()
      for (const e of episodicFtsRaw) {
        contentMap.set(`ep:${e.id}`, {
          content: e.content,
          source: 'episodic',
          metadata: { tags: e.tags, sourceType: e.sourceType, salience: e.salience, agentId: e.agentId },
        })
      }
      for (const v of vaultFiltered) {
        contentMap.set(`vt:${v.path}`, {
          content: v.content,
          source: 'vault',
          metadata: { path: v.path, title: v.title, tier: v.tier, tags: v.tags },
        })
      }
      for (const a of archiveRaw) {
        contentMap.set(`ar:${a.id}`, {
          content: a.content,
          source: 'archive',
          metadata: { tags: a.tags },
        })
      }

      // --- Graph boosts: seed from top vault FTS hits ---
      let graphBoosts = new Map<string, number>()
      if (graphSearch && vaultFiltered.length > 0) {
        const seeds = vaultFiltered.slice(0, 5).map(v => ({ type: 'vault' as const, id: v.path }))
        const raw = graphSearch.computeBoosts(seeds, 0.005)
        // Remap vault:path → vt:path for the content map key scheme.
        for (const [k, b] of raw) {
          if (k.startsWith('vault:')) graphBoosts.set(`vt:${k.slice('vault:'.length)}`, b)
        }
      }

      // --- RRF fusion (one list per source) ---
      const ftsItems = [
        ...episodicFtsRaw.map(e => ({ id: `ep:${e.id}`, score: e.score, source: 'episodic' as const })),
        ...vaultFiltered.map(v => ({ id: `vt:${v.path}`, score: v.score, source: 'vault' as const })),
        ...archiveRaw.map(a => ({ id: `ar:${a.id}`, score: a.score, source: 'archive' as const })),
      ]
      const vecItems = [
        ...episodicVecRaw.map(e => ({ id: `ep:${e.id}`, score: e.score, source: 'episodic' as const })),
        ...vaultVecRaw.map(v => ({ id: `vt:${v.path}`, score: v.score, source: 'vault' as const })),
      ]

      const fused = computeRRF(ftsItems, vecItems, graphBoosts, {
        k: 60,
        ftsWeight: weights.ftsWeight,
        vectorWeight: weights.vectorWeight,
      })

      // --- Hydrate results ---
      const hydrated: MemorySearchResult[] = []
      for (const entry of fused) {
        const hit = contentMap.get(entry.id)
        if (!hit) continue
        const realId = entry.id.slice(3)  // strip prefix
        hydrated.push({
          source: hit.source,
          id: realId,
          content: hit.content,
          score: entry.score,
          metadata: hit.metadata,
        })
        if (hydrated.length >= limit) break
      }

      return hydrated
    },

    stats() {
      const workingBlocks = deps.working.listAll()
      const episodicAll = deps.episodic.list({ limit: 10000 })
      const episodicValid = episodicAll.filter(m => !m.validUntil)
      const episodicInvalid = episodicAll.filter(m => m.validUntil)
      const archiveList = deps.archive.list(10000)
      const vaultFiles = deps.vault.listFiles()

      const saliences = episodicValid.map(m => m.salience)
      const avgSalience = saliences.length > 0 ? saliences.reduce((a, b) => a + b, 0) / saliences.length : 0
      const minSalience = saliences.length > 0 ? Math.min(...saliences) : 0
      const maxSalience = saliences.length > 0 ? Math.max(...saliences) : 0

      const bySourceType: Record<string, number> = {}
      for (const m of episodicValid) {
        bySourceType[m.sourceType] = (bySourceType[m.sourceType] ?? 0) + 1
      }

      const tagCounts: Record<string, number> = {}
      for (const m of episodicValid) {
        for (const tag of m.tags) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }))

      const recentEpisodic = episodicValid
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map(m => ({ id: m.id, content: m.content.slice(0, 100), salience: m.salience, sourceType: m.sourceType, createdAt: m.createdAt }))

      const promotionCandidates = episodicValid
        .filter(m => m.salience > 0.7 && m.accessCount >= 3)
        .length

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const demotionCandidates = episodicValid
        .filter(m => m.salience < 0.2 && m.createdAt < thirtyDaysAgo)
        .length

      return {
        tiers: {
          working: {
            count: workingBlocks.length,
            blocks: workingBlocks.map(b => ({ key: b.key, contentLength: b.content.length, expiresAt: b.expiresAt })),
          },
          episodic: {
            total: episodicAll.length,
            valid: episodicValid.length,
            invalidated: episodicInvalid.length,
            avgSalience: Math.round(avgSalience * 1000) / 1000,
            minSalience: Math.round(minSalience * 1000) / 1000,
            maxSalience: Math.round(maxSalience * 1000) / 1000,
            bySourceType,
            promotionCandidates,
            demotionCandidates,
          },
          archive: {
            count: archiveList.length,
          },
          vault: {
            fileCount: vaultFiles.length,
            files: vaultFiles,
          },
        },
        topTags,
        recentEpisodic,
      }
    },

    /** Tier services — used by importers and consolidators. */
    working: deps.working,
    episodic: deps.episodic,
    archive: deps.archive,
    vault: deps.vault,
    indexer: deps.indexer,
  }
}

export type MemoryService = ReturnType<typeof createMemoryService>
