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
import { importPersonasFromDirectory, resolvePersonaImportRoots, parsePersonaMarkdown, mapToolNames } from '@modules/agent/persona-import'
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
    expect(agent!.tools).toEqual(['read_file', 'grep'])
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

  it('leaves an existing role alone when the file declares none', async () => {
    registry.create({
      id: 'bravo',
      name: 'Bravo',
      role: 'the role someone chose',
      description: 'generic',
      goal: 'g',
      backstory: 'b',
      systemPrompt: 'Template prompt.',
      capabilities: [],
      tools: [],
      constraints: [],
      source: 'seed',
    })
    // No `role:` key: the parser falls back to the description or the id, and
    // writing that would silently replace a role the owner set.
    writeFileSync(join(dir, 'bravo.md'), '---\nname: bravo\n---\nImported prompt.\n')

    await importPersonasFromDirectory(registry, dir)
    expect(registry.get('bravo')!.role).toBe('the role someone chose')
  })

  it('takes the role from a file that does declare one', async () => {
    registry.create({
      id: 'charlie',
      name: 'Charlie',
      role: 'the old role',
      description: 'generic',
      goal: 'g',
      backstory: 'b',
      systemPrompt: 'Template prompt.',
      capabilities: [],
      tools: [],
      constraints: [],
      source: 'seed',
    })
    writeFileSync(join(dir, 'charlie.md'), '---\nname: charlie\nrole: the declared role\n---\nPrompt.\n')

    await importPersonasFromDirectory(registry, dir)
    expect(registry.get('charlie')!.role).toBe('the declared role')
  })

  it('returns 0 for a missing directory', async () => {
    expect(await importPersonasFromDirectory(registry, join(dir, 'missing'))).toBe(0)
  })

  it('skips files without YAML frontmatter', async () => {
    writeFileSync(join(dir, 'notes.md'), '# just a note\n')
    expect(await importPersonasFromDirectory(registry, dir)).toBe(0)
    expect(registry.list()).toEqual([])
  })

  it('maps Claude tool names for importRoots personas too', async () => {
    writeFileSync(join(dir, 'r.md'), '---\nname: r\ndescription: reviewer\ntools:\n  - Read\n  - Grep\n---\nReview.')
    await importPersonasFromDirectory(registry, dir)
    expect(registry.get('r')?.tools).toEqual(['read_file', 'grep'])
  })
})

describe('agent_definitions.config', () => {
  it('stores the free-form JSON an import puts on the row, and null without one', () => {
    // The column exists so a persona's own frontmatter survives the import even
    // where EYAS has no typed field for it; nothing else writes it today, so a
    // silent drop here would take that provenance with it.
    const db = makeDb()
    const registry = createAgentRegistry(db)
    const common = {
      name: 'X',
      role: 'r',
      description: 'd',
      goal: 'g',
      backstory: 'b',
      systemPrompt: 'p',
      capabilities: [],
      tools: [],
      constraints: [],
      source: 'user' as const,
    }
    registry.create({ ...common, id: 'with-config', config: JSON.stringify({ import: { a: 1 } }) })
    registry.create({ ...common, id: 'without-config' })
    const rows = db.all(sql`SELECT id, config FROM agent_definitions ORDER BY id`) as Array<{
      id: string
      config: string | null
    }>
    expect(rows).toEqual([
      { id: 'with-config', config: '{"import":{"a":1}}' },
      { id: 'without-config', config: null },
    ])
  })
})

describe('parsePersonaMarkdown', () => {
  const DEV = '---\nname: developer\ndescription: "Senior developer - writes code"\ntools:\n  - Read\n  - Write\n  - Bash\n  - Magic\n---\nYou write clean code.\n'

  it('maps frontmatter, body and tools', () => {
    const p = parsePersonaMarkdown(DEV, 'developer')!
    expect(p).toMatchObject({
      id: 'developer',
      name: 'developer',
      description: 'Senior developer - writes code',
      systemPrompt: 'You write clean code.',
      agentType: 'developer',
      tier: 'team',
    })
    expect(p.tools).toEqual(['read_file', 'write_file', 'run_command'])
    expect(p.originalTools).toEqual(['Read', 'Write', 'Bash', 'Magic'])
    expect(p.unknownTools).toEqual(['Magic'])
  })

  it('accepts a comma/space-separated tools string', () => {
    const p = parsePersonaMarkdown('---\nname: r\ndescription: reviewer\ntools: Read, Grep\n---\nReview.', 'r')!
    expect(p.originalTools).toEqual(['Read', 'Grep'])
    expect(p.tools).toEqual(['read_file', 'grep'])
  })

  it('falls back to the stem when frontmatter has no id or name', () => {
    const p = parsePersonaMarkdown('---\ndescription: nameless\n---\nBody.', 'stem-id')!
    expect(p.id).toBe('stem-id')
    expect(p.name).toBe('stem-id')
  })

  it('returns null without frontmatter', () => {
    expect(parsePersonaMarkdown('just text', 'x')).toBeNull()
  })
})

describe('mapToolNames', () => {
  it('omits tools when nothing maps, instead of a tool-less agent', () => {
    expect(mapToolNames(['Magic'])).toEqual({ tools: undefined, unknown: ['Magic'] })
    expect(mapToolNames([])).toEqual({ tools: undefined, unknown: [] })
  })

  it('maps the full Claude → EYAS tool table', () => {
    expect(mapToolNames(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']))
      .toEqual({ tools: ['read_file', 'write_file', 'edit_file', 'run_command', 'glob', 'grep', 'research'], unknown: [] })
  })

  it('reports a lowercase name this instance has no tool for as unknown', () => {
    // A snake_case name is not proof of a tool: handing `custom_tool` to the
    // agent as an id would leave the runner filtering the list down to nothing.
    expect(mapToolNames(['read_file', 'custom_tool'])).toEqual({
      tools: ['read_file'],
      unknown: ['custom_tool'],
    })
  })

  it('accepts a name the live registry knows, whatever the built-in table says', () => {
    expect(mapToolNames(['custom_tool'], (id) => id === 'custom_tool')).toEqual({
      tools: ['custom_tool'],
      unknown: [],
    })
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
