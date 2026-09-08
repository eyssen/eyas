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
import { hasSecretsTag, resolveProjectTypeId, vaultNoteInScope, SECRETS_TAG } from './memory-index.js'
import { ftsConversation, type ConversationFtsHit } from './search/conversation-fts.js'

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
  /**
   * Live read of `memory.recall.includeSecrets` (D-7 / P-19). An accessor
   * rather than a captured value, so nothing has to be rebuilt when the config
   * object behind it changes. Absent means false — a build with no config
   * fails closed.
   */
  recall?: () => { includeSecrets: boolean }
}

export interface MemorySearchOptions extends MemorySearchQuery {
  agentId?: string
  includeShared?: boolean
  /**
   * Explicit override of the `contains-secrets` exclusion. The model-facing
   * `search_memory` tool never sets it and offers no way to ask for it. On the
   * HTTP surface it is owner-gated: `GET /memory/search` refuses the query
   * parameter unless the caller holds `delete` on MemoryEntry, which the `user`
   * and `agent` roles do not.
   */
  includeSecrets?: boolean
}

/**
 * An episodic row can now be a whole imported transcript (R11.1 removed every
 * size cap), and a search result is a model-facing payload. Above the
 * threshold the hit becomes a window around the first query term instead of
 * the whole body; `metadata.contentLength` says what was left behind, and the
 * row itself is still readable in full by id.
 */
const EXCERPT_THRESHOLD_CHARS = 4_000
const EXCERPT_CHARS = 3_000
const EXCERPT_LEAD_CHARS = 1_500

function excerpt(content: string, query: string): { content: string; truncated: boolean } {
  if (content.length <= EXCERPT_THRESHOLD_CHARS) return { content, truncated: false }
  const needle = query.split(/\s+/).find((t) => t.length > 2)?.toLowerCase() ?? ''
  const at = needle ? content.toLowerCase().indexOf(needle) : -1
  const start = at < 0 ? 0 : Math.max(0, at - EXCERPT_LEAD_CHARS)
  return { content: `${start > 0 ? '…' : ''}${content.slice(start, start + EXCERPT_CHARS)}…`, truncated: true }
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

  function likeNeedle(query: string): string | null {
    const token = query.split(/\s+/).map((t) => t.replace(/[%_]/g, '')).find((t) => [...t].length >= 4)
    if (!token) return null
    return `%${token.toLowerCase()}%`
  }

  function ftsLayered(
    query: string,
    limit: number,
    projectId: string | null,
    excludeConversationId: string | null,
  ): Array<{
    id: string
    score: number
    content: string
    source: MemorySearchResult['source']
    metadata: Record<string, unknown>
  }> {
    if (!deps.db) return []
    const out: Array<{
      id: string
      score: number
      content: string
      source: MemorySearchResult['source']
      metadata: Record<string, unknown>
    }> = []
    const fts = escapeFtsQuery(query)
    const projectFilter = projectId
      ? sql`AND (r.project_id = ${projectId} OR r.project_id IS NULL)`
      : sql`AND r.project_id IS NULL`
    const exclude = excludeConversationId
      ? sql`AND r.conversation_id != ${excludeConversationId}`
      : sql``
    try {
      const raw = safeAll<{
        id: string
        conversationId: string | null
        sourceType: string
        snippet: string
        fts_score: number
      }>(sql`
        SELECT r.id AS id,
               r.conversation_id AS conversationId,
               r.source_type AS sourceType,
               COALESCE(g.text, r.conversation_id) AS snippet,
               -bm25(memory_raw_fts) AS fts_score
        FROM memory_raw_fts
        JOIN memory_raw r ON r.rid = memory_raw_fts.rowid
        LEFT JOIN memory_gist g ON g.scope_type = 'task'
          AND g.scope_id = r.conversation_id
          AND g.is_current = 1
          AND g.tombstoned = 0
        WHERE memory_raw_fts MATCH ${fts}
          AND r.tombstoned = 0
          ${projectFilter}
          ${exclude}
        ORDER BY fts_score DESC
        LIMIT ${limit}
      `)
      for (const row of raw) {
        const ex = excerpt(row.snippet ?? '', query)
        out.push({
          id: `rw:${row.id}`,
          score: Number(row.fts_score) || 0,
          content: ex.content,
          source: 'raw',
          metadata: {
            conversationId: row.conversationId,
            sourceType: row.sourceType,
            ...(ex.truncated ? { truncated: true, contentLength: (row.snippet ?? '').length } : {}),
          },
        })
      }
    } catch { /* memory_raw_fts missing on fixtures that predate v2 */ }

    const needle = likeNeedle(query)
    if (needle) {
      try {
        const gists = safeAll<{ id: string; text: string; scopeId: string | null; importance: number }>(sql`
          SELECT id, text, scope_id AS scopeId, importance_score AS importance
          FROM memory_gist
          WHERE is_current = 1 AND tombstoned = 0 AND trust_tier != 'quarantined'
            AND lower(text) LIKE ${needle}
          ORDER BY importance_score DESC
          LIMIT ${limit}
        `)
        for (const row of gists) {
          out.push({
            id: `gs:${row.id}`,
            score: 0.5 + Math.min(0.4, Number(row.importance) || 0),
            content: row.text,
            source: 'gist',
            metadata: { scopeId: row.scopeId },
          })
        }
      } catch { /* gist table missing */ }
      try {
        const facts = safeAll<{ id: string; subject: string; predicate: string; objectText: string }>(sql`
          SELECT id, subject, predicate, object_text AS objectText
          FROM memory_fact
          WHERE tombstoned = 0 AND valid_until IS NULL AND trust_tier != 'quarantined'
            AND (lower(subject) LIKE ${needle} OR lower(object_text) LIKE ${needle})
          ORDER BY confidence DESC
          LIMIT ${limit}
        `)
        for (const row of facts) {
          out.push({
            id: `ft:${row.id}`,
            score: 0.55,
            content: `${row.subject} ${row.predicate} ${row.objectText}`,
            source: 'fact',
            metadata: { subject: row.subject, predicate: row.predicate },
          })
        }
      } catch { /* fact table missing */ }
    }
    return out
  }

  return {
    working: deps.working,
    episodic: deps.episodic,
    archive: deps.archive,
    vault: deps.vault,
    indexer: deps.indexer,

    /**
     * Hybrid search across memory tiers: FTS5 (episodic + vault + archive + L0
     * conversation + memory_raw / gist / fact) + optional vector search +
     * wikilink graph boosts, fused with Reciprocal Rank Fusion.
     */
    async search(query: MemorySearchOptions): Promise<MemorySearchResult[]> {
      const tiers = query.tiers ?? ['episodic', 'semantic', 'procedural', 'archive', 'conversation']
      const limit = query.limit ?? 20
      const wantEpisodic = tiers.includes('episodic')
      const wantVault = tiers.includes('semantic') || tiers.includes('procedural')
      const wantArchive = tiers.includes('archive')
      const wantConversation = tiers.includes('conversation')
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

      // D-7 / P-19 — the recall gate. An explicit call wins, then the live
      // config, then the exclusion: a service built without a config reader
      // hides flagged rows rather than showing them.
      const includeSecrets = query.includeSecrets ?? deps.recall?.().includeSecrets ?? false
      const recallable = (tags: string[]) => includeSecrets || !tags.includes(SECRETS_TAG)

      // --- FTS ---
      const episodicFtsRaw = (wantEpisodic ? ftsEpisodic(query.query, perSource, query.agentId, query.includeShared ?? true) : [])
        .filter((e) => recallable(e.tags))
      const vaultFtsRaw = wantVault ? ftsVault(query.query, perSource) : []
      const archiveRaw = (wantArchive ? ftsArchive(query.query, perSource) : [])
        .filter((a) => recallable(a.tags))
      let conversationRaw: ConversationFtsHit[] = []
      if (wantConversation && deps.db) {
        try {
          conversationRaw = ftsConversation(deps.db, query.query, {
            limit: perSource,
            projectId,
            scope: query.scope,
            excludeConversationId: query.excludeConversationId,
          })
        } catch { /* conversation_fts missing on older fixtures */ }
      }

      // Filter vault by requested tiers (semantic/procedural), then by note scope.
      const vaultFiltered = vaultFtsRaw
        .filter(v => tiers.includes(v.tier as any))
        .filter(noteInScope)
        .filter(v => recallable(v.tags))

      // --- Vector (optional, via embeddings provider) ---
      let episodicVecRaw: Array<{ id: string; score: number }> = []
      let vaultVecRaw: Array<{ path: string; score: number }> = []
      if (deps.embeddings) {
        try {
          if (wantEpisodic) episodicVecRaw = await deps.embeddings.searchEpisodic(query.query, perSource, query.agentId)
          if (wantVault) vaultVecRaw = await deps.embeddings.searchVault(query.query, perSource)
        } catch { /* embeddings unavailable */ }
        // The lookup used to run only for scope=current; it now also runs
        // whenever the secrets gate is closed, because a vector hit reaches
        // the result list without ever passing through the FTS filter above.
        if ((query.scope === 'current' || !includeSecrets) && vaultVecRaw.length > 0) {
          const known = new Map(vaultFtsRaw.map(v => [v.path, v]))
          vaultVecRaw = vaultVecRaw.filter(v => {
            const row = known.get(v.path)
            if (row) return noteInScope(row) && recallable(row.tags)
            const found = safeAll<{
              kind: string | null; tier: string
              project_id: string | null; project_type_id: string | null
              tags: string | null
            }>(sql`SELECT kind, tier, project_id, project_type_id, tags FROM vault_index WHERE path = ${v.path}`)[0]
            if (!found) return true
            // Malformed tags read as "no tags": a broken JSON blob must not
            // lose the owner a note.
            return noteInScope(found) && (includeSecrets || !hasSecretsTag(found.tags))
          })
        }
      }

      // --- Content map for hydration ---
      const contentMap = new Map<string, { content: string; source: MemorySearchResult['source']; metadata: Record<string, unknown> }>()
      for (const e of episodicFtsRaw) {
        const ex = excerpt(e.content, query.query)
        contentMap.set(`ep:${e.id}`, {
          content: ex.content,
          source: 'episodic',
          metadata: {
            tags: e.tags, sourceType: e.sourceType, salience: e.salience, agentId: e.agentId,
            ...(ex.truncated ? { truncated: true, contentLength: e.content.length } : {}),
          },
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
      for (const c of conversationRaw) {
        contentMap.set(`cv:${c.conversationId}:${c.messageId}`, {
          content: c.body,
          source: 'conversation',
          metadata: {
            conversationId: c.conversationId,
            messageId: c.messageId,
            title: c.title,
            role: c.role,
          },
        })
      }

      const layered = ftsLayered(query.query, perSource, projectId, query.excludeConversationId ?? null)
      for (const hit of layered) {
        contentMap.set(hit.id, { content: hit.content, source: hit.source, metadata: hit.metadata })
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
        ...conversationRaw.map(c => ({
          id: `cv:${c.conversationId}:${c.messageId}`,
          score: c.score,
          source: 'conversation' as const,
        })),
        ...layered.map(h => ({ id: h.id, score: h.score, source: h.source })),
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
      // Episodic VECTOR hits need no secrets filter of their own: hydration
      // only emits ids that are already in contentMap, and contentMap's
      // episodic entries come from the filtered FTS list above. A flagged row
      // that only the vector channel found has no content to hydrate and is
      // dropped here.
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
  }
}

export type MemoryService = ReturnType<typeof createMemoryService>
