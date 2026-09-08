// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-7 on the skill side: a skill whose bundled asset held a credential
// (capability `contains-secrets`) is never proposed to a turn unless
// `memory.recall.includeSecrets` is on — one 'apply' click would otherwise put
// the inlined key straight into the system prompt.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createSkillMatcher } from '@modules/skills/skill-matcher'
import { createSkillsRoutes, type SkillsServices } from '@modules/skills/routes'
import { DEFAULT_CLASSIFY_CONFIG } from '@modules/skills/classify-skill'
import { recallableSkills } from '@modules/skills/recallable'

const flagged = { id: 's1', name: 'alpha deploy', capabilities: ['imported', 'contains-secrets'] } as any
const plain = { id: 's2', name: 'bravo deploy', capabilities: ['imported'] } as any

describe('recallableSkills', () => {
  it('drops a flagged skill by default and keeps it when the flag is on', () => {
    expect(recallableSkills([flagged, plain], false).map((s) => s.id)).toEqual(['s2'])
    expect(recallableSkills([flagged, plain], true).map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('treats a skill with no capabilities at all as recallable', () => {
    const bare = { id: 's3', name: 'charlie deploy' } as any
    expect(recallableSkills([bare], false).map((s) => s.id)).toEqual(['s3'])
  })
})

const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function createSkillsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
    trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT, integration_config TEXT, sources TEXT,
    source TEXT NOT NULL DEFAULT 'user', source_path TEXT, source_root TEXT,
    last_seen_at TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    disabled_reason TEXT, disabled_at TEXT, disabled_by TEXT,
    use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL, path TEXT NOT NULL,
    root TEXT NOT NULL, seen_at TEXT NOT NULL, UNIQUE(skill_id, path, root)
  )`)
}

let db: any
let services: SkillsServices

function mount(includeSecrets: boolean): Hono {
  services.recall = () => ({ includeSecrets })
  const app = new Hono()
  app.use('*', async (c: any, next: any) => {
    c.set('ability', { can: () => true })
    c.set('userId', 'op')
    await next()
  })
  createSkillsRoutes(app, services)
  return app
}

async function match(app: Hono): Promise<any[]> {
  const res = await app.request('/api/v1/skills/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'deploy the alpha release' }),
  })
  expect(res.status).toBe(200)
  return (await res.json() as any).matches
}

beforeEach(() => {
  db = createMemoryDb()
  createSkillsTable(db)
  const loader = createSkillLoader(db, mockLogger)
  loader.create({
    name: 'alpha deploy',
    content: 'Run the alpha deploy with PGPASSWORD=alphabravocharlie0001',
    triggerPatterns: ['alpha deploy', 'deploy the alpha'],
    capabilities: ['imported', 'contains-secrets'],
  })
  loader.create({
    name: 'bravo deploy',
    content: 'Run the bravo deploy',
    triggerPatterns: ['deploy the alpha release'],
    capabilities: ['imported'],
  })
  services = { loader, matcher: createSkillMatcher(), db, classifyConfig: DEFAULT_CLASSIFY_CONFIG }
})

describe('POST /api/v1/skills/match', () => {
  it('never returns a contains-secrets skill by default', async () => {
    const matches = await match(mount(false))
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.map((m: any) => m.skill.name)).not.toContain('alpha deploy')
  })

  it('returns it once the owner opened memory.recall.includeSecrets', async () => {
    const matches = await match(mount(true))
    expect(matches.map((m: any) => m.skill.name)).toContain('alpha deploy')
  })

  it('excludes it when no recall accessor is wired at all', async () => {
    // A build whose memory module never started must fail closed, not open.
    delete (services as any).recall
    const app = new Hono()
    app.use('*', async (c: any, next: any) => {
      c.set('ability', { can: () => true })
      c.set('userId', 'op')
      await next()
    })
    createSkillsRoutes(app, services)
    const matches = await match(app)
    expect(matches.map((m: any) => m.skill.name)).not.toContain('alpha deploy')
  })
})
