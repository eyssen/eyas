// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Markdown personas from instance directories, not burned into src/.
// Fixtures stay fictive (alpha / bravo).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { resolve } from 'node:path'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import { importPersonasFromDirectory, resolvePersonaImportRoots } from '@modules/agent/persona-import'
import { configSchema } from '@core/config/schema'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT,
    goal TEXT, backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist', agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT,
    model TEXT, max_turns INTEGER, effort TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed',
    avatar TEXT, tags TEXT,
    monthly_token_budget INTEGER DEFAULT 0, tokens_used_month INTEGER DEFAULT 0,
    budget_reset_at TEXT, config TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  return db
}

describe('resolvePersonaImportRoots', () => {
  it('defaults to an empty list', () => {
    expect(resolvePersonaImportRoots({})).toEqual([])
  })

  it('expands a leading tilde and drops blanks', () => {
    expect(resolvePersonaImportRoots({
      agent: { importRoots: ['~/alpha-agents', '', '/tmp/bravo'] },
    })).toEqual([join(homedir(), 'alpha-agents'), '/tmp/bravo'])
  })
})

describe('config schema — agent.importRoots', () => {
  it('defaults to an empty list', () => {
    expect(configSchema.parse({}).agent.importRoots).toEqual([])
  })
})

describe('importPersonasFromDirectory', () => {
  let registry: ReturnType<typeof createAgentRegistry>
  let dir: string

  beforeEach(() => {
    registry = createAgentRegistry(makeDb())
    dir = join(tmpdir(), `eyas-persona-import-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true }) } catch {}
  })

  it('imports a markdown persona: body is the prompt, frontmatter is metadata', async () => {
    writeFileSync(join(dir, 'alpha.md'), `---
name: alpha
description: Alpha reviewer for type-a work
tools:
  - Read
  - Grep
---
You are alpha. Challenge assumptions on type-a work.
`)

    const count = await importPersonasFromDirectory(registry, dir)
    expect(count).toBe(1)
    const agent = registry.get('alpha')
    expect(agent).toBeTruthy()
    expect(agent!.name).toBe('alpha')
    expect(agent!.description).toBe('Alpha reviewer for type-a work')
    expect(agent!.systemPrompt).toBe('You are alpha. Challenge assumptions on type-a work.')
    expect(agent!.tools).toEqual(['Read', 'Grep'])
    expect(agent!.enabled).toBe(true)
  })

  it('overlays an existing agent of the same id with the file contents', async () => {
    registry.create({
      id: 'alpha',
      name: 'Template Alpha',
      role: 'reviewer',
      description: 'generic',
      goal: 'g',
      backstory: 'b',
      systemPrompt: 'Template prompt.',
      capabilities: [],
      tools: ['read_file'],
      constraints: [],
      source: 'seed',
    })
    writeFileSync(join(dir, 'alpha.md'), `---
name: alpha
description: Imported alpha
---
Imported prompt for alpha.
`)

    await importPersonasFromDirectory(registry, dir)
    const agent = registry.get('alpha')!
    expect(agent.systemPrompt).toBe('Imported prompt for alpha.')
    expect(agent.description).toBe('Imported alpha')
    expect(agent.source).toBe('seed')
  })

  it('returns 0 for a missing directory', async () => {
    expect(await importPersonasFromDirectory(registry, join(dir, 'missing'))).toBe(0)
  })

  it('skips files without YAML frontmatter', async () => {
    writeFileSync(join(dir, 'notes.md'), '# just a note\n')
    expect(await importPersonasFromDirectory(registry, dir)).toBe(0)
    expect(registry.list()).toEqual([])
  })
})

describe('agent module wiring', () => {
  it('imports markdown personas from configured roots and does not revive YAML seedFromDirectory', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/agent/index.ts'), 'utf-8')
    expect(source).toContain('importPersonasFromDirectory')
    expect(source).toContain('resolvePersonaImportRoots')
    expect(source).not.toContain('seedFromDirectory')
    expect(source).not.toContain('config/agents')
  })
})
