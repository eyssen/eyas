// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import { callerMaySeeSecrets } from '@modules/memory/http-secrets.js'
import { hasSecretsTag } from '@modules/memory/memory-index.js'

interface MemoryDeps {
  episodicMemory: {
    list(opts: { agentId?: string; includeShared?: boolean; limit?: number }): any[]
  }
  workingMemory: {
    listByPrefix(prefix: string): any[]
  }
}

/**
 * A-33 — an episodic row can now be a whole imported transcript, so `limit=50`
 * on this route could answer with hundreds of megabytes of body. The body is
 * cut to a readable head and `contentChars` carries the real length, because a
 * cut body with no visible count reads as a complete one.
 */
const MEMORY_BODY_PREVIEW_CHARS = 4_000

function withBodyPreview<T extends { content?: unknown }>(memory: T): T {
  const content = memory?.content
  if (typeof content !== 'string' || content.length <= MEMORY_BODY_PREVIEW_CHARS) return memory
  // Never cut between the halves of a surrogate pair: a lone half renders as
  // a replacement character and is not what the source said.
  let end = MEMORY_BODY_PREVIEW_CHARS
  const lead = content.charCodeAt(end - 1)
  if (lead >= 0xd800 && lead <= 0xdbff) end -= 1
  return { ...memory, content: content.slice(0, end), contentChars: content.length }
}

export function createAgentMemoryRoutes(app: Hono, deps: MemoryDeps) {
  app.get(
    '/api/v1/agents/:id/memories',
    requirePermission('read', 'Agent'),
    (c) => {
      const agentId = c.req.param('id')
      const tier = c.req.query('tier') ?? 'episodic'
      const limit = parseInt(c.req.query('limit') ?? '20', 10)

      if (tier === 'working') {
        const blocks = deps.workingMemory.listByPrefix(`${agentId}:`)
        return c.json({ memories: blocks, tier: 'working', agentId })
      }

      // D-7, the fourth door: this route is guarded by `read` on Agent, which
      // the `agent` role holds, and it returns whole episodic bodies. Same
      // caller-keyed rule as the memory module's own routes — a non-owner does
      // not get a flagged row here either.
      const maySeeSecrets = callerMaySeeSecrets(c)
      const memories = deps.episodicMemory.list({
        agentId,
        includeShared: false,
        limit,
      })
        .filter((m) => maySeeSecrets || !hasSecretsTag(m?.tags))
        .map(withBodyPreview)
      return c.json({ memories, tier: 'episodic', agentId })
    },
  )
}
