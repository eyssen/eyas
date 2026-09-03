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
import type { EyasDb } from '@core/types'

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
    const results = await memory.search({ query, tiers, limit, agentId, includeShared })
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
    return c.json(memory.episodic.list({ validOnly, limit }))
  })

  app.get('/api/v1/memory/episodic/:id', requirePermission('read', 'MemoryEntry'), (c) => {
    const mem = memory.episodic.get(c.req.param('id'))
    if (!mem) return c.json({ error: 'Not found' }, 404)
    return c.json(mem)
  })

  app.get('/api/v1/memory/archive', requirePermission('read', 'MemoryEntry'), (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10)
    return c.json(memory.archive.list(limit))
  })

  app.get('/api/v1/memory/archive/:id', requirePermission('read', 'MemoryEntry'), (c) => {
    const mem = memory.archive.get(c.req.param('id'))
    if (!mem) return c.json({ error: 'Not found' }, 404)
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
    return c.json(memory.vault.listFiles())
  })

  app.get('/api/v1/memory/vault/*', requirePermission('read', 'MemoryEntry'), (c) => {
    const raw = c.req.path.replace('/api/v1/memory/vault/', '')
    const path = safeVaultPath(raw)
    if (!path) return c.json({ error: 'Invalid path' }, 400)
    const entry = memory.vault.read(path)
    if (!entry) return c.json({ error: 'Vault file not found' }, 404)
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
    memory.vault.write(path, body.frontmatter, body.content)
    memory.indexer.indexAll()
    return c.json({ path, status: 'saved' })
  })

  app.get('/api/v1/memory/stats', requirePermission('read', 'MemoryEntry'), (c) => {
    return c.json(memory.stats())
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

      const files = memory.vault.listFiles()
      const nodes = files.map(f => {
        const entry = memory.vault.read(f)
        return {
          id: f,
          label: entry?.frontmatter.title ?? f.split('/').pop()?.replace(/\.md$/i, '') ?? f,
          tier: entry?.frontmatter.tier ?? 'semantic',
          tags: entry?.frontmatter.tags ?? [],
        }
      })

      const outgoing = new Map<string, Array<{ targetId: string; context: string | null }>>()
      for (const f of files) {
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

      return c.json({ target, backlinks: merged })
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
      return c.json({ tag, notes: tagsSvc.notesByTag(tag) })
    })

    // ─── Dataview-style frontmatter query (P2.12) ─────────────────────
    const queryService = createVaultQuery(extras.db, memory.vault)
    app.post('/api/v1/memory/vault/query', requirePermission('read', 'MemoryEntry'), async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const parsed = VaultQuerySchema.safeParse(body)
      if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
      return c.json({ results: queryService.query(parsed.data) })
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

    app.get('/api/v1/memory/review/wiki-proposals', requirePermission('read', 'MemoryEntry'), (c) => {
      const status = (c.req.query('status') as any) ?? 'pending'
      return c.json({ proposals: reviewQueue.listWikiProposals(status) })
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
    return c.json({ templates: templatesSvc.list() })
  })

  app.post('/api/v1/memory/vault/from-template', requirePermission('create', 'MemoryEntry'), async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body?.templatePath || !body?.targetPath || !body?.title) {
      return c.json({ error: 'templatePath, targetPath, and title required' }, 400)
    }
    const tp = safeVaultPath(String(body.templatePath))
    const target = safeVaultPath(String(body.targetPath))
    if (!tp || !target) return c.json({ error: 'Invalid path' }, 400)
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
