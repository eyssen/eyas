// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A-33. An episodic row can now be a whole imported transcript, so
// `GET /api/v1/agents/:id/memories?limit=50` could answer with hundreds of
// megabytes. The route cuts the body to a head and reports the real length in
// `contentChars`; the panel prints that count
// (`agents.detail.memoryTruncated`, six languages), because a cut body with no
// visible count reads as a complete one.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createAgentMemoryRoutes } from '@modules/agent/routes-memory'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

/** Mirrors MEMORY_BODY_PREVIEW_CHARS in routes-memory.ts. */
const PREVIEW = 4_000

let db: ReturnType<typeof createMemoryDb>
let episodicMemory: ReturnType<typeof createEpisodicMemoryService>

function mount(): Hono {
  const ability = buildAbilityForRole('owner', createPermissionRegistry())
  const app = new Hono()
  app.use('*', async (c: any, next: any) => { c.set('ability', ability); await next() })
  createAgentMemoryRoutes(app, {
    episodicMemory,
    workingMemory: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
  })
  return app
}

async function memories(): Promise<any[]> {
  const res = await mount().request('/api/v1/agents/a1/memories?tier=episodic&limit=50')
  expect(res.status).toBe(200)
  return ((await res.json()) as any).memories
}

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  episodicMemory = createEpisodicMemoryService(db)
})

describe('GET /api/v1/agents/:id/memories — body size', () => {
  it('leaves a short body whole and says nothing about a count', async () => {
    episodicMemory.create({ content: 'alpha bravo charlie', sourceType: 'system', agentId: 'a1' })
    const [row] = await memories()
    expect(row.content).toBe('alpha bravo charlie')
    expect(row.contentChars).toBeUndefined()
  })

  it('cuts a long body to the head and reports the real length', async () => {
    const body = 'a'.repeat(PREVIEW * 3)
    episodicMemory.create({ content: body, sourceType: 'system', agentId: 'a1' })
    const [row] = await memories()
    expect(row.content).toHaveLength(PREVIEW)
    expect(row.contentChars).toBe(body.length)
    // The count is what makes the cut honest — the panel renders it.
    expect(row.contentChars).toBeGreaterThan(row.content.length)
  })

  it('never cuts between the halves of a surrogate pair', async () => {
    // An astral character straddling the boundary: the pair starts at
    // PREVIEW - 1, so a blind slice would keep only its lead half.
    const body = 'a'.repeat(PREVIEW - 1) + '𝄞' + 'b'.repeat(100)
    episodicMemory.create({ content: body, sourceType: 'system', agentId: 'a1' })
    const [row] = await memories()
    expect(row.content).toHaveLength(PREVIEW - 1)
    expect(row.content).not.toContain('\ud834')
    expect([...row.content].every((ch) => ch === 'a')).toBe(true)
    expect(row.contentChars).toBe(body.length)
  })

  it('does not touch the working tier, whose blocks are not episodic bodies', async () => {
    const res = await mount().request('/api/v1/agents/a1/memories?tier=working')
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).tier).toBe('working')
  })
})
