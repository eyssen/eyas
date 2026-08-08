// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'

interface MemoryDeps {
  episodicMemory: {
    list(opts: { agentId?: string; includeShared?: boolean; limit?: number }): any[]
  }
  workingMemory: {
    listByPrefix(prefix: string): any[]
  }
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

      const memories = deps.episodicMemory.list({
        agentId,
        includeShared: false,
        limit,
      })
      return c.json({ memories, tier: 'episodic', agentId })
    },
  )
}
