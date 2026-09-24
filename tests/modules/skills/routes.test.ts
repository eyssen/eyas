// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createSkillMatcher } from '@modules/skills/skill-matcher'
import { createSkillsRoutes } from '@modules/skills/routes'
import { DEFAULT_CLASSIFY_CONFIG } from '@modules/skills/classify-skill'

const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function createSkillsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    trigger_patterns TEXT,
    capabilities TEXT,
    version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL,
    skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT,
    integration_config TEXT,
    sources TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    source_path TEXT,
    source_root TEXT,
    last_seen_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    disabled_reason TEXT,
    disabled_at TEXT,
    disabled_by TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL,
    path TEXT NOT NULL,
    root TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    UNIQUE(skill_id, path, root)
  )`)
}

let app: Hono

beforeEach(() => {
  const db = createMemoryDb()
  createSkillsTable(db)
  const loader = createSkillLoader(db, mockLogger)
  const matcher = createSkillMatcher()
  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createSkillsRoutes(app, { loader, matcher, db, classifyConfig: DEFAULT_CLASSIFY_CONFIG })
})

describe('POST /api/v1/skills validation', () => {
  const post = (body: unknown) =>
    app.request('/api/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('creates a skill with valid payload (201)', async () => {
    const res = await post({ name: 'My Skill', content: 'do the thing' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.skill.name).toBe('My Skill')
    expect(body.skill.content).toBe('do the thing')
  })

  it('rejects a payload missing name with 400 (not a 500 NOT NULL crash)', async () => {
    const res = await post({ description: 'no name here', content: 'x' })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })

  it('rejects a payload missing content with 400', async () => {
    const res = await post({ name: 'Nameless content' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty name with 400', async () => {
    const res = await post({ name: '', content: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/skills/inventory', () => {
  it('returns every skill as an inventory row', async () => {
    await app.request('/api/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Inventoried', content: 'x' }),
    })
    const res = await app.request('/api/v1/skills/inventory')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ name: 'Inventoried', shadowedSources: [] })
  })
})

describe('GET /api/v1/skills/dead-candidates', () => {
  it('returns no candidates for a fresh, healthy skill set', async () => {
    await app.request('/api/v1/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Brand New', content: 'x' }),
    })
    const res = await app.request('/api/v1/skills/dead-candidates')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    // A newly created skill is inside the grace period — never a candidate.
    expect(body.items).toEqual([])
  })
})
