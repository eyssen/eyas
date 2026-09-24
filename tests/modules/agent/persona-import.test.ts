// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Markdown personas from instance directories, not burned into src/.
// Fixtures stay fictive (alpha / bravo).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { resolve } from 'node:path'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import {
  createPersonaImportLedger,
  importPersonasFromDirectory,
  resolvePersonaImportRoots,
  parsePersonaMarkdown,
  mapToolNames,
  type PersonaImportLedger,
} from '@modules/agent/persona-import'
import { createPathPolicy, workAreaRootsOf, type PathPolicy } from '@shared/memory-sovereignty/path-policy'
import { selectImportRoots } from '@shared/memory-sovereignty/import-roots'
import { configSchema } from '@core/config/schema'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT,
    goal TEXT, backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist', agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT,
    provider TEXT, model TEXT, max_turns INTEGER, effort TEXT,
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
  let db: ReturnType<typeof makeDb>
  let registry: ReturnType<typeof createAgentRegistry>
  let ledger: PersonaImportLedger
  let dir: string

  const run = (d = dir) => importPersonasFromDirectory(registry, d, { ledger })

  const TEMPLATE = {
    role: 'reviewer',
    description: 'generic',
    goal: 'g',
    backstory: 'b',
    systemPrompt: 'Template prompt.',
    capabilities: [],
    tools: ['read_file'],
    constraints: [],
  }

  beforeEach(() => {
    db = makeDb()
    registry = createAgentRegistry(db)
    ledger = createPersonaImportLedger(db)
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

    const result = await run()
    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0, kept: [], deleted: [], shadowed: [], failed: 0 })
    const agent = registry.get('alpha')
    expect(agent).toBeTruthy()
    expect(agent!.name).toBe('alpha')
    expect(agent!.description).toBe('Alpha reviewer for type-a work')
    expect(agent!.systemPrompt).toBe('You are alpha. Challenge assumptions on type-a work.')
    expect(agent!.tools).toEqual(['read_file', 'grep'])
    expect(agent!.enabled).toBe(true)
    const record = ledger.get('alpha')!
    expect(record.sourcePath).toBe(resolve(dir, 'alpha.md'))
    expect(record.fileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.rowHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('updates an imported persona the owner has not edited when its file changes', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: first\n---\nFirst prompt.\n')
    await run()
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: second\ntools: Read\n---\nSecond prompt.\n')

    const result = await run()
    expect(result).toMatchObject({ created: 0, updated: 1, kept: [] })
    const agent = registry.get('alpha')!
    expect(agent.systemPrompt).toBe('Second prompt.')
    expect(agent.description).toBe('second')
    expect(agent.tools).toEqual(['read_file'])
  })

  it('writes nothing when neither the file nor the agent changed', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\n---\nPrompt.\n')
    await run()
    const before = registry.get('alpha')!.updatedAt
    await new Promise((r) => setTimeout(r, 5))

    const result = await run()
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 })
    expect(registry.get('alpha')!.updatedAt).toBe(before)
  })

  it('never overwrites a persona edited in EYAS after the import, whatever the file says', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: first\n---\nFirst prompt.\n')
    await run()
    registry.update('alpha', { systemPrompt: 'Edited on the Agents page.' })
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: second\n---\nSecond prompt.\n')

    const result = await run()
    expect(result).toMatchObject({ updated: 0, kept: ['alpha'] })
    const agent = registry.get('alpha')!
    expect(agent.systemPrompt).toBe('Edited on the Agents page.')
    expect(agent.description).toBe('first')

    // …and it stays that way on every later start.
    const again = await run()
    expect(again.kept).toEqual(['alpha'])
    expect(registry.get('alpha')!.systemPrompt).toBe('Edited on the Agents page.')
  })

  it('keeps updating when only fields the import never writes were changed (model, enabled)', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\n---\nFirst prompt.\n')
    await run()
    registry.update('alpha', { model: 'model-x', enabled: false })
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\n---\nSecond prompt.\n')

    const result = await run()
    expect(result.updated).toBe(1)
    const agent = registry.get('alpha')!
    expect(agent.systemPrompt).toBe('Second prompt.')
    expect(agent.model).toBe('model-x')
    expect(agent.enabled).toBe(false)
  })

  it('does not bring back an imported persona that was deleted in EYAS', async () => {
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\n---\nPrompt.\n')
    await run()
    registry.delete('alpha')

    const result = await run()
    expect(result).toMatchObject({ created: 0, deleted: ['alpha'] })
    expect(registry.get('alpha')).toBeUndefined()
  })

  it('never overwrites an existing agent the import did not create (a template or a UI agent)', async () => {
    registry.create({ ...TEMPLATE, id: 'alpha', name: 'Template Alpha', source: 'seed' })
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: Imported alpha\n---\nImported prompt for alpha.\n')

    const result = await run()
    expect(result).toMatchObject({ created: 0, updated: 0, kept: ['alpha'] })
    const agent = registry.get('alpha')!
    expect(agent.systemPrompt).toBe('Template prompt.')
    expect(agent.name).toBe('Template Alpha')
    expect(agent.source).toBe('seed')
    expect(ledger.get('alpha')).toBeUndefined()
  })

  it('adopts an existing agent that already matches its file, so later file changes reach it', async () => {
    // A row imported before the ledger existed and never edited since.
    registry.create({
      ...TEMPLATE,
      id: 'alpha',
      name: 'alpha',
      role: 'legacy',
      description: 'legacy',
      systemPrompt: 'Legacy prompt.',
      tools: [],
      source: 'user',
    })
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\nrole: legacy\ndescription: legacy\n---\nLegacy prompt.\n')

    const adopted = await run()
    expect(adopted).toMatchObject({ unchanged: 1, kept: [] })
    expect(ledger.get('alpha')).toBeTruthy()

    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\nrole: legacy\ndescription: legacy\n---\nNew prompt.\n')
    const updated = await run()
    expect(updated.updated).toBe(1)
    expect(registry.get('alpha')!.systemPrompt).toBe('New prompt.')
  })

  it('lets the first root own an id: a second root with the same id is shadowed, not applied', async () => {
    const other = `${dir}-other`
    mkdirSync(other, { recursive: true })
    try {
      writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\n---\nFrom the first root.\n')
      writeFileSync(join(other, 'alpha.md'), '---\nname: alpha\n---\nFrom the second root.\n')
      await run(dir)
      const second = await run(other)
      expect(second).toMatchObject({ updated: 0, shadowed: ['alpha'] })
      expect(registry.get('alpha')!.systemPrompt).toBe('From the first root.')

      // The owning file goes away: the id passes to the file that is still there.
      rmSync(join(dir, 'alpha.md'))
      const handover = await run(other)
      expect(handover.updated).toBe(1)
      expect(registry.get('alpha')!.systemPrompt).toBe('From the second root.')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('leaves the role alone when a later file version declares none', async () => {
    writeFileSync(join(dir, 'bravo.md'), '---\nname: bravo\nrole: the role someone chose\n---\nPrompt.\n')
    await run()
    // No `role:` key: the parser falls back to the description or the id, and
    // writing that would silently replace a role the file set before.
    writeFileSync(join(dir, 'bravo.md'), '---\nname: bravo\n---\nNew prompt.\n')

    await run()
    const agent = registry.get('bravo')!
    expect(agent.systemPrompt).toBe('New prompt.')
    expect(agent.role).toBe('the role someone chose')
  })

  it('takes the role from a file version that does declare one', async () => {
    writeFileSync(join(dir, 'charlie.md'), '---\nname: charlie\nrole: the old role\n---\nPrompt.\n')
    await run()
    writeFileSync(join(dir, 'charlie.md'), '---\nname: charlie\nrole: the declared role\n---\nPrompt.\n')

    await run()
    expect(registry.get('charlie')!.role).toBe('the declared role')
  })

  it('does nothing for a missing directory', async () => {
    const result = await run(join(dir, 'missing'))
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 0, failed: 0 })
  })

  it('skips files without YAML frontmatter', async () => {
    writeFileSync(join(dir, 'notes.md'), '# just a note\n')
    const result = await run()
    expect(result.created).toBe(0)
    expect(registry.list()).toEqual([])
  })

  it('maps Claude tool names for importRoots personas too', async () => {
    writeFileSync(join(dir, 'r.md'), '---\nname: r\ndescription: reviewer\ntools:\n  - Read\n  - Grep\n---\nReview.')
    await run()
    expect(registry.get('r')?.tools).toEqual(['read_file', 'grep'])
  })
})

describe('agent.importRoots — provider-native roots', () => {
  let root: string
  let home: string
  let policy: PathPolicy

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-persona-roots-'))
    home = join(root, 'home')
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
    mkdirSync(join(root, 'team-agents'), { recursive: true })
    const dataDir = join(root, 'data')
    policy = createPathPolicy({
      homeDir: home,
      env: {},
      dataDir,
      workspacesRoot: join(dataDir, 'workspaces'),
      workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: join(dataDir, 'workspaces') }),
      providerHomes: [join(dataDir, 'cli-homes')],
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('skips ~/.claude/agents and keeps a team folder', () => {
    const roots = resolvePersonaImportRoots({
      agent: { importRoots: [join(home, '.claude', 'agents'), join(root, 'team-agents')] },
    })
    const { scan, skipped } = selectImportRoots(roots, policy)
    expect(scan).toEqual([join(root, 'team-agents')])
    expect(skipped).toEqual([
      { root: join(home, '.claude', 'agents'), relation: 'inside', label: 'Claude Code (~/.claude)' },
    ])
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
    // Provider-native roots are filtered, and every import goes through the ledger.
    expect(source).toContain('selectImportRoots(resolvePersonaImportRoots(ctx.config))')
    expect(source).toContain('createPersonaImportLedger')
    expect(source).not.toContain('seedFromDirectory')
    expect(source).not.toContain('config/agents')
  })
})
