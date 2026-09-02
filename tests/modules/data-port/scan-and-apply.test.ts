// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'
import { OWN_SKILLS_CATEGORY } from '@modules/data-port/constants'
import { createSkillLoader } from '@modules/skills/skill-loader'

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

describe('data-port scan + skill apply', () => {
  let root: string
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createDataPortService>
  let createdSkills: Array<{ id: string; category?: string; name: string }>

  beforeEach(() => {
    root = join(tmpdir(), `eyas-dataport-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })
    mkdirSync(join(root, '99_Meta', 'ai-memory'), { recursive: true })
    writeFileSync(
      join(root, 'CLAUDE.md'),
      '# Project rules\n\nAlways write tests.\n',
    )
    writeFileSync(
      join(root, 'MEMORY.md'),
      '# Memory index\n\n- [[alpha]]\n- [[bravo]]\n',
    )
    writeFileSync(
      join(root, '99_Meta', 'ai-memory', 'alpha-pref.md'),
      '---\nname: pref\ndescription: work style\ntype: feedback\n---\nPrefer concise answers.\n',
    )
    writeFileSync(
      join(root, 'skills', 'deploy.md'),
      '---\nname: deploy\ndescription: Deploy guide\ntrigger_patterns: ["deploy"]\n---\n# Deploy\n\n1. Build\n2. Ship\n',
    )

    db = createMemoryDb()
    createDataPortTables(db)
    createSkillsTable(db)
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    const loader = createSkillLoader(db, logger)
    createdSkills = []

    service = createDataPortService({
      db,
      modelCtx: {}, // no model → heuristic/fail-open
      applyDepsFactory: () => ({
        skills: {
          create: (input) => {
            const s = loader.create(input)
            createdSkills.push(s)
            return s
          },
        },
        createProposal: (input) => service.createProposal(input),
        resolveDefaultAgentId: () => 'agent-1',
        readWorkspaceFile: () => null,
      }),
      dataDir: root,
      logger,
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('scans directory and finds candidates', () => {
    const result = service.scanPath('auto', root)
    expect(result.scanId).toBeTruthy()
    expect(result.candidates.length).toBeGreaterThanOrEqual(2)
    expect(result.detectedProfile).toBe('claude-code')
    const kinds = result.candidates.map((c) => c.kind)
    expect(kinds).toContain('rule')
    expect(kinds).toContain('skill')
    expect(kinds).toContain('memory')
    const index = result.candidates.find((c) => c.relativePath.endsWith('MEMORY.md'))
    if (index) expect(index.kind).toBe('noise')
  })

  it('imports skill into own category', async () => {
    const result = service.scanPath('auto', root)
    const skillCand = result.candidates.find((c) => c.kind === 'skill')
    expect(skillCand).toBeTruthy()

    const job = service.createJob({
      scanId: result.scanId,
      sourceProfile: result.detectedProfile,
      selection: [{ candidateId: skillCand!.id, target: 'skill' }],
    })

    // Wait for background job
    for (let i = 0; i < 50; i++) {
      const j = service.getJob(job.id)
      if (j?.status === 'completed' || j?.status === 'failed') break
      await new Promise((r) => setTimeout(r, 50))
    }

    const done = service.getJob(job.id)
    expect(done?.status).toBe('completed')
    expect(done?.stats.applied).toBeGreaterThanOrEqual(1)
    expect(createdSkills.length).toBeGreaterThanOrEqual(1)
    expect(createdSkills[0]!.category).toBe(OWN_SKILLS_CATEGORY)
  })

  it('creates workspace proposal instead of auto-merge for rules', async () => {
    const result = service.scanPath('auto', root)
    const rule = result.candidates.find((c) => c.kind === 'rule')
    expect(rule).toBeTruthy()

    const job = service.createJob({
      scanId: result.scanId,
      sourceProfile: result.detectedProfile,
      selection: [{ candidateId: rule!.id, target: 'workspace.agents' }],
    })

    for (let i = 0; i < 50; i++) {
      const j = service.getJob(job.id)
      if (j?.status === 'completed' || j?.status === 'failed') break
      await new Promise((r) => setTimeout(r, 50))
    }

    const proposals = service.listProposals({ jobId: job.id })
    expect(proposals.length).toBeGreaterThanOrEqual(1)
    expect(proposals[0]!.status).toBe('pending')
    expect(proposals[0]!.workspaceFile).toBe('AGENTS.md')
  })

  it('export endpoint returns coming_soon', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    createDataPortRoutes(app, { service })
    const res = await app.request('/api/v1/data-port/export', { method: 'POST' })
    expect(res.status).toBe(503)
    const body = await res.json() as any
    expect(body.error).toBe('coming_soon')
  })
})
