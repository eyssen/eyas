// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-7 / N3, the fourth door. `GET /api/v1/agents/:id/memories` returns whole
// episodic bodies and is guarded by `read` on Agent, which the `agent` role
// holds (`permissions/roles.ts`). Same caller-keyed rule as the memory
// module's own routes: the owner-only right is `delete` on MemoryEntry.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createAgentMemoryRoutes } from '@modules/agent/routes-memory'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

const KEY = 'alphabravocharlie0001'

let db: ReturnType<typeof createMemoryDb>
let episodicMemory: ReturnType<typeof createEpisodicMemoryService>

/** Grants come from roles.ts itself, so the test moves when the table moves. */
function mountAs(role: 'owner' | 'admin' | 'user' | 'agent'): Hono {
  const ability = buildAbilityForRole(role, createPermissionRegistry())
  const app = new Hono()
  app.use('*', async (c: any, next: any) => { c.set('ability', ability); await next() })
  createAgentMemoryRoutes(app, {
    episodicMemory,
    workingMemory: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
  })
  return app
}

async function memories(role: 'owner' | 'admin' | 'user' | 'agent'): Promise<any[]> {
  const res = await mountAs(role).request('/api/v1/agents/a1/memories?tier=episodic&limit=50')
  expect(res.status).toBe(200)
  return ((await res.json()) as any).memories
}

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  episodicMemory = createEpisodicMemoryService(db)
  episodicMemory.create({ content: `zxq agent row PGPASSWORD=${KEY}`, sourceType: 'system', agentId: 'a1', tags: ['contains-secrets'] })
  episodicMemory.create({ content: 'zxq ordinary agent row', sourceType: 'system', agentId: 'a1' })
})

describe('GET /api/v1/agents/:id/memories', () => {
  it('never hands a flagged body to an agent-role caller', async () => {
    const rows = await memories('agent')
    expect(JSON.stringify(rows)).not.toContain(KEY)
    expect(rows).toHaveLength(1)
  })

  it('withholds it from a plain user and an admin too', async () => {
    expect(JSON.stringify(await memories('user'))).not.toContain(KEY)
    expect(JSON.stringify(await memories('admin'))).not.toContain(KEY)
  })

  it('gives the owner everything, as before', async () => {
    const rows = await memories('owner')
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows)).toContain(KEY)
  })

  it('still returns the ordinary row to an agent, so this is not a blanket denial', async () => {
    expect(JSON.stringify(await memories('agent'))).toContain('ordinary agent row')
  })
})
