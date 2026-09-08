// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { MemoryService } from './memory-service.js'
import type { WikilinkService } from '@shared/wikilinks'
import { createVaultQuery, VaultQuerySchema } from './vault/vault-query.js'
import { createTagsService } from './vault/tags-service.js'
import { createTemplatesService } from './vault/templates-service.js'
import { createReviewQueue } from './consolidator/review-queue.js'
import { buildVaultGraph } from './vault/graph-builder.js'
import { callerMaySeeSecrets, flaggedVaultPaths } from './http-secrets.js'
import { isStorableTagsValue, normaliseFrontmatterTags } from './vault/frontmatter.js'
import { hasSecretsTag, SECRETS_TAG } from './memory-index.js'
import type { EyasDb } from '@core/types'

/** How much of an episodic body the list view carries. The detail route has the rest. */
const EPISODIC_PREVIEW_CHARS = 400

/** Promote working memory blocks accessed 3+ times to episodic tier */
function promoteHotWorkingBlocks(memory: MemoryService): number {
  const candidates = memory.working.findPromotionCandidates(3)
  let promoted = 0
  for (const block of candidates) {
    memory.episodic.create({
      content: block.content,
      sourceType: 'system',
      sourceId: `working:${block.key}`,
      tags: ['auto-promoted', 'from-working'],
    })
    memory.working.delete(block.key)
    promoted++
  }
  return promoted
}

// Decode a path and ensure it contains no traversal segments after URL decoding.
function safeVaultPath(raw: string): string | null {
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { return null }
  if (decoded.includes('..') || decoded.startsWith('/') || decoded.includes('\0')) return null
  return decoded
}

export function createMemoryRoutes(
  app: Hono,
  memory: MemoryService,
  logger: Logger,
  extras?: { db?: EyasDb; wikilinks?: WikilinkService },
) {
  app.get('/api/v1/memory/search', requirePermission('read', 'MemoryEntry'), async (c) => {
    const query = c.req.query('query')
    if (!query) return c.json({ error: 'query parameter required' }, 400)
    const tiers = c.req.query('tiers')?.split(',').filter(Boolean) as any
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    const agentId = c.req.query('agentId') || undefined
    const includeShared = c.req.query('includeShared') !== 'false'
    // D-7 / P-19 — revealing a contains-secrets note takes more than `read` on
    // MemoryEntry, which the `user` AND `agent` roles both hold: an agent
    // principal asking for the hidden notes by name would defeat the gate the
    // search_memory tool schema is built to enforce. `delete` on MemoryEntry is
    // held by the owner alone in roles.ts, so that is the right this override
    // requires. Refused outright rather than silently downgraded — a caller who
    // asked for the notes must not believe an empty-of-secrets list is complete.
    const wantsSecrets = c.req.query('includeSecrets') === 'true'
    if (wantsSecrets && !callerMaySeeSecrets(c)) {
      return c.json({ error: 'Forbidden: includeSecrets requires delete on MemoryEntry' }, 403)
    }
    // `undefined` (not false) so the configured default still decides for
    // every request that did not ask.
    const includeSecrets = wantsSecrets ? true : undefined
    const results = await memory.search({ query, tiers, limit, agentId, includeShared, includeSecrets })
    return c.json({ results, total: results.length })
  })

  app.get('/api/v1/memory/working', requirePermission('read', 'MemoryEntry'), (c) => {
    return c.json(memory.working.listAll())
  })

  app.patch('/api/v1/memory/working/:key', requirePermission('update', 'MemoryEntry'), async (c) => {
    const key = c.req.param('key')
    const body = await c.req.json()
    if (!body.content) return c.json({ error: 'content required' }, 400)
    memory.working.set(key, body.content, body.maxTokens)
    return c.json(memory.working.get(key))
  })

  app.get('/api/v1/memory/episodic', requirePermission('read', 'MemoryEntry'), (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10)
    const validOnly = c.req.query('validOnly') !== 'false'
    const maySeeSecrets = callerMaySeeSecrets(c)
    // An imported transcript is now a whole episodic row with no size cap
    // (R11.1), so the list view ships a preview and a length instead of every
    // body. `/episodic/:id` still returns the row in full.
    return c.json(memory.episodic.list({ validOnly, limit })
      // D-7: the preview IS body content, and the row's id is the key to the
      // full body next door. A caller who is not the owner sees neither.
      .filter((mem) => maySeeSecrets || !hasSecretsTag(mem.tags))
      .map(({ content, ...rest }) => ({
        ...rest,
        preview: content.replace(/\s+/g, ' ').trim().slice(0, EPISODIC_PREVIEW_CHARS),
        contentLength: content.length,
      })))
  })

  app.get('/api/v1/memory/episodic/:id', requirePermission('read', 'MemoryEntry'), (c) => {
    const mem = memory.episodic.get(c.req.param('id'))
    if (!mem) return c.json({ error: 'Not found' }, 404)
    // D-7: 404 rather than 403 — the list this caller can see does not contain
    // the row, so "not found" is the honest answer for that caller, and a 403
    // would confirm which ids hold credentials.
    if (hasSecretsTag(mem.tags) && !callerMaySeeSecrets(c)) return c.json({ error: 'Not found' }, 404)
    return c.json(mem)
  })

  app.get('/api/v1/memory/archive', requirePermission('read', 'MemoryEntry'), (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10)
    const maySeeSecrets = callerMaySeeSecrets(c)
    // An archived row is a demoted episodic row and keeps its tags with it.
    return c.json(memory.archive.list(limit).filter((mem) => maySeeSecrets || !hasSecretsTag(mem.tags)))
  })

  app.get('/api/v1/memory/archive/:id', requirePermission('read', 'MemoryEntry'), (c) => {
    const mem = memory.archive.get(c.req.param('id'))
    if (!mem) return c.json({ error: 'Not found' }, 404)
    if (hasSecretsTag(mem.tags) && !callerMaySeeSecrets(c)) return c.json({ error: 'Not found' }, 404)
    return c.json(mem)
  })

  app.post('/api/v1/memory/episodic', requirePermission('create', 'MemoryEntry'), async (c) => {
    const body = await c.req.json()
    if (!body.content || !body.sourceType) {
      return c.json({ error: 'content and sourceType required' }, 400)
    }
    const mem = memory.episodic.create(body)
    return c.json(mem, 201)
  })

  app.get('/api/v1/memory/vault', requirePermission('read', 'MemoryEntry'), (c) => {
    const files = memory.vault.listFiles()
    if (callerMaySeeSecrets(c)) return c.json(files)
    // D-7: this list is the index that leads to the note bodies next door, so
    // it omits the flagged paths rather than advertising what to fetch.
    const flagged = flaggedVaultPaths({ db: extras?.db, vault: memory.vault }, files)
    return c.json(files.filter((path) => !flagged.has(path)))
  })

  app.get('/api/v1/memory/vault/*', requirePermission('read', 'MemoryEntry'), (c) => {
    const raw = c.req.path.replace('/api/v1/memory/vault/', '')
    const path = safeVaultPath(raw)
    if (!path) return c.json({ error: 'Invalid path' }, 400)
    const entry = memory.vault.read(path)
    if (!entry) return c.json({ error: 'Vault file not found' }, 404)
    // D-7: the note's own frontmatter is the authority here, not the index.
    if (hasSecretsTag(entry.frontmatter.tags) && !callerMaySeeSecrets(c)) {
      return c.json({ error: 'Vault file not found' }, 404)
    }
    return c.json(entry)
  })

  app.put('/api/v1/memory/vault/*', requirePermission('update', 'MemoryEntry'), async (c) => {
    const raw = c.req.path.replace('/api/v1/memory/vault/', '')
    const path = safeVaultPath(raw)
    if (!path) return c.json({ error: 'Invalid path' }, 400)
    const body = await c.req.json()
    if (!body.frontmatter || !body.content) {
      return c.json({ error: 'frontmatter and content required' }, 400)
    }
    // Rejected rather than silently discarded: the vault keeps `tags` only as
    // an array, so accepting any other shape would answer 200 to a request
    // whose tags are about to be thrown away.
    if (!isStorableTagsValue(body.frontmatter.tags)) {
      return c.json({ error: 'frontmatter.tags must be an array of strings' }, 400)
    }
    // D-7, the same immutability rule and the same normalise-first shape as
    // `from-template`: a caller may rewrite a note, but not un-flag one, and
    // the question is asked in the form the store will keep. `update` on
    // MemoryEntry is held by `user` and `admin`, neither of whom can read a
    // flagged note through door 2, so this is not a disclosure path today — it
    // is the rule the ruling states, applied wherever it fits.
    const tags = normaliseFrontmatterTags(body.frontmatter.tags)
    const existing = memory.vault.read(path)
    const frontmatter = {
      ...body.frontmatter,
      tags: existing && hasSecretsTag(existing.frontmatter.tags) && !tags.includes(SECRETS_TAG)
        ? [...tags, SECRETS_TAG]
        : tags,
    }
    memory.vault.write(path, frontmatter, body.content)
    memory.indexer.indexAll()
    return c.json({ path, status: 'saved' })
  })

  app.get('/api/v1/memory/stats', requirePermission('read', 'MemoryEntry'), (c) => {
    const stats = memory.stats()
    if (callerMaySeeSecrets(c)) return c.json(stats)
    // D-7, the door the sweep found that the review had not named: `stats`
    // carries the first 100 characters of each recent episodic BODY, and the
    // whole vault path list. Counts stay whole — a total is not content, and
    // shrinking it would misreport the tier.
    const flaggedIds = new Set(
      memory.episodic.list({ limit: 10_000 }).filter((m) => hasSecretsTag(m.tags)).map((m) => m.id),
    )
    const flaggedPaths = flaggedVaultPaths({ db: extras?.db, vault: memory.vault }, stats.tiers.vault.files)
    return c.json({
      ...stats,
      tiers: {
        ...stats.tiers,
        vault: { ...stats.tiers.vault, files: stats.tiers.vault.files.filter((p) => !flaggedPaths.has(p)) },
      },
      recentEpisodic: stats.recentEpisodic.filter((m) => !flaggedIds.has(m.id)),
    })
  })

  app.post('/api/v1/memory/consolidate', requirePermission('update', 'MemoryEntry'), async (c) => {
    const promoted = promoteHotWorkingBlocks(memory)
    memory.working.cleanupExpired()
    const indexed = memory.indexer.indexAll()
    memory.indexer.removeStale()
    return c.json({ indexed, promoted, message: 'Consolidation complete' })
  })

  // ─── Wikilink graph + backlinks (P2.9, P2.10) ───────────────────────
  if (extras?.wikilinks) {
    const wikilinks = extras.wikilinks

    app.get('/api/v1/memory/wikilinks/graph', requirePermission('read', 'MemoryEntry'), (c) => {
      // Obsidian-style graph: wikilinks + soft edges (tags / topic clusters from path).
      const includeSoft = c.req.query('includeTags') !== '0' // keep query name for UI compat
      const maxSoft = Math.min(2500, parseInt(c.req.query('maxTagEdges') ?? '1200', 10) || 1200)

      const maySeeSecrets = callerMaySeeSecrets(c)
      const files = memory.vault.listFiles()
      const nodes = files.map(f => {
        const entry = memory.vault.read(f)
        return {
          id: f,
          label: entry?.frontmatter.title ?? f.split('/').pop()?.replace(/\.md$/i, '') ?? f,
          tier: entry?.frontmatter.tier ?? 'semantic',
          tags: entry?.frontmatter.tags ?? [],
        }
      // D-7: a graph node names the note and titles it. Same index rule as the
      // vault list — a non-owner is not shown that the note exists.
      }).filter((n) => maySeeSecrets || !hasSecretsTag(n.tags))

      // D-7, door 9: an edge carries a ±30-character window of the SOURCE
      // note's body (wikilink-parser.ts:66-72), so building this map from the
      // raw file list put back both the path the node filter had just hidden
      // and the credential inside it. Same class as backlinks — filter the edge
      // source, not only the node list.
      const visible = new Set(nodes.map((n) => n.id))
      const outgoing = new Map<string, Array<{ targetId: string; context: string | null }>>()
      for (const f of files) {
        if (!visible.has(f)) continue
        const outs = wikilinks.getOutgoing('vault', f)
          .filter(o => o.targetType === 'vault')
          .map(o => ({ targetId: o.targetId, context: o.context }))
        if (outs.length) outgoing.set(f, outs)
      }

      const graph = buildVaultGraph({
        nodes,
        outgoing,
        includeSoftEdges: includeSoft,
        maxSoftEdges: maxSoft,
      })

      return c.json(graph)
    })

    app.get('/api/v1/memory/wikilinks/backlinks', requirePermission('read', 'MemoryEntry'), (c) => {
      const target = c.req.query('target')
      if (!target) return c.json({ error: 'target parameter required' }, 400)

      // Wikilinks store the raw link name (e.g. `kubernetes-networking`) while
      // callers typically ask by canonical vault path (`semantic/kubernetes-networking.md`).
      // Collect all possible names a note might be referenced by: the path itself,
      // its basename (with and without .md), its frontmatter title, and aliases.
      const candidates = new Set<string>()
      candidates.add(target)
      const basename = target.replace(/\.md$/i, '').split('/').pop()
      if (basename) candidates.add(basename)
      const entry = memory.vault.read(target)
      if (entry?.frontmatter.title) candidates.add(entry.frontmatter.title)
      for (const alias of entry?.frontmatter.aliases ?? []) candidates.add(String(alias))

      const seen = new Set<number>()
      const merged: Array<{ id: number; sourceType: string; sourceId: string; targetType: string; targetId: string; context: string | null; createdAt: string }> = []
      for (const name of candidates) {
        for (const bl of wikilinks.getBacklinks('vault', name)) {
          if (seen.has(bl.id)) continue
          seen.add(bl.id)
          merged.push(bl)
        }
      }

      // D-7, the sixth door and the least obvious one: a backlink's `context`
      // is an excerpt of the SOURCE note's text (wikilink-parser.ts:72), so a
      // flagged note that links to anything would hand a non-owner a slice of
      // its body here.
      if (callerMaySeeSecrets(c)) return c.json({ target, backlinks: merged })
      const sourcePaths = merged.filter((b) => b.sourceType === 'vault').map((b) => b.sourceId)
      const flagged = flaggedVaultPaths({ db: extras?.db, vault: memory.vault }, sourcePaths)
      return c.json({
        target,
        backlinks: merged.filter((b) => b.sourceType !== 'vault' || !flagged.has(b.sourceId)),
      })
    })
  }

  // ─── Tags pivot (P2.10) ──────────────────────────────────────────────
  if (extras?.db) {
    const tagsSvc = createTagsService(extras.db)

    app.get('/api/v1/memory/tags', requirePermission('read', 'MemoryEntry'), (c) => {
      return c.json({ tags: tagsSvc.listTags() })
    })

    app.get('/api/v1/memory/tags/:tag', requirePermission('read', 'MemoryEntry'), (c) => {
      const tag = c.req.param('tag')
      const notes = tagsSvc.notesByTag(tag)
      if (callerMaySeeSecrets(c)) return c.json({ tag, notes })
      // D-7: `contains-secrets` is itself a tag, so this route would otherwise
      // hand a non-owner a directory of exactly which notes to go and read.
      const flagged = flaggedVaultPaths({ db: extras.db, vault: memory.vault }, notes.map((n) => n.path))
      return c.json({ tag, notes: notes.filter((n) => !flagged.has(n.path)) })
    })

    // ─── Dataview-style frontmatter query (P2.12) ─────────────────────
    const queryService = createVaultQuery(extras.db, memory.vault)
    app.post('/api/v1/memory/vault/query', requirePermission('read', 'MemoryEntry'), async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const parsed = VaultQuerySchema.safeParse(body)
      if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
      const results = queryService.query(parsed.data)
      if (callerMaySeeSecrets(c)) return c.json({ results })
      const flagged = flaggedVaultPaths({ db: extras.db, vault: memory.vault }, results.map((r) => r.path))
      return c.json({ results: results.filter((r) => !flagged.has(r.path)) })
    })

    // ─── Review queue (P3.13) ─────────────────────────────────────────
    const reviewQueue = createReviewQueue(extras.db)

    app.get('/api/v1/memory/review/skill-candidates', requirePermission('read', 'MemoryEntry'), (c) => {
      const status = (c.req.query('status') as any) ?? 'pending'
      return c.json({ candidates: reviewQueue.listSkillCandidates(status) })
    })

    app.post('/api/v1/memory/review/skill-candidates/:id', requirePermission('update', 'MemoryEntry'), async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const status = body.status
      if (status !== 'approved' && status !== 'rejected') {
        return c.json({ error: 'status must be approved or rejected' }, 400)
      }
      const ok = reviewQueue.reviewSkillCandidate({ id, status, reviewerId: body.reviewerId })
      return c.json({ ok })
    })

    /*
     * Door 12. A wiki proposal carries `proposedBody` — "the whole proposed
     * markdown body" — and it is DERIVED from the vault note at `pagePath`, so
     * it is the same class as the backlink excerpt (door 6) and the graph edge
     * (A-38): the filter belongs on the excerpt's SOURCE, not on the row.
     *
     * Closed while the producer is still a stub (`memory/index.ts` passes
     * `proposeEditsForClient: () => []`, so no row is ever written today). That
     * is the cheapest moment to close it: one filter now, against a leak nobody
     * would be looking for on the day phase 3F wires a real port.
     *
     * When that port lands it inherits A-37's obligation as well: a proposal
     * composed from SEVERAL notes must record which, or carry the flag itself,
     * because this filter can only see the one note the proposal names.
     */
    app.get('/api/v1/memory/review/wiki-proposals', requirePermission('read', 'MemoryEntry'), (c) => {
      const status = (c.req.query('status') as any) ?? 'pending'
      const proposals = reviewQueue.listWikiProposals(status)
      if (callerMaySeeSecrets(c)) return c.json({ proposals })
      const flagged = flaggedVaultPaths(
        { db: extras?.db, vault: memory.vault },
        proposals.map((p) => p.pagePath),
      )
      return c.json({ proposals: proposals.filter((p) => !flagged.has(p.pagePath)) })
    })

    app.post('/api/v1/memory/review/wiki-proposals/:id', requirePermission('update', 'MemoryEntry'), async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const status = body.status
      if (status !== 'applied' && status !== 'rejected') {
        return c.json({ error: 'status must be applied or rejected' }, 400)
      }
      const ok = reviewQueue.reviewWikiProposal({ id, status, reviewerId: body.reviewerId })
      return c.json({ ok })
    })
  }

  // ─── Templates + daily notes (P2.11) ─────────────────────────────────
  const templatesSvc = createTemplatesService(memory.vault)

  app.get('/api/v1/memory/templates', requirePermission('read', 'MemoryEntry'), (c) => {
    const templates = templatesSvc.list()
    if (callerMaySeeSecrets(c)) return c.json({ templates })
    // Same index rule as the vault list: a flagged note filed under templates/
    // is not advertised to a caller who could not then read it.
    const flagged = flaggedVaultPaths({ db: extras?.db, vault: memory.vault }, templates.map((t) => t.path))
    return c.json({ templates: templates.filter((t) => !flagged.has(t.path)) })
  })

  app.post('/api/v1/memory/vault/from-template', requirePermission('create', 'MemoryEntry'), async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.templatePath || !body?.targetPath || !body?.title) {
      return c.json({ error: 'templatePath, targetPath, and title required' }, 400)
    }
    const tp = safeVaultPath(String(body.templatePath))
    const target = safeVaultPath(String(body.targetPath))
    if (!tp || !target) return c.json({ error: 'Invalid path' }, 400)
    // Same reason as the PUT above, and it also turns what used to be an
    // unhandled spread of a non-array into an answer the caller can act on.
    if (!isStorableTagsValue(body.extraFrontmatter?.tags)) {
      return c.json({ error: 'extraFrontmatter.tags must be an array of strings' }, 400)
    }
    const result = templatesSvc.createFromTemplate({
      templatePath: tp,
      targetPath: target,
      title: String(body.title),
      extraFrontmatter: body.extraFrontmatter,
    })
    if (!result) return c.json({ error: 'Template not found' }, 404)
    memory.indexer.indexAll()
    return c.json(result, 201)
  })

  app.post('/api/v1/memory/vault/daily', requirePermission('create', 'MemoryEntry'), (c) => {
    const result = templatesSvc.getOrCreateDailyNote()
    memory.indexer.indexAll()
    return c.json(result, result.created ? 201 : 200)
  })

  logger.info('Memory routes registered')
}
