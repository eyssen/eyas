// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createSkillMatcher } from '@modules/skills/skill-matcher'
import { createSkillsRoutes } from '@modules/skills/routes'

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
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  createSkillsRoutes(app, { loader, matcher })
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
