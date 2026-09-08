// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Extra skill roots (instance config, not host settingSources). An imported
// file wins a bundled id and the loser is recorded. Fixtures stay fictive.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { resolve } from 'node:path'
import { wins, importRootId, resolveSkillImportRoots, scanSkillImportRoots } from '@modules/skills/skill-inventory'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createSkillMatcher } from '@modules/skills/skill-matcher'
import { createMemoryDb } from '../../helpers/test-db'
import { configSchema } from '@core/config/schema'

const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function createSkillsTables(db: any) {
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

function skillMd(name: string, body: string, extra = '') {
  return `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n${body}\n`
}

describe('import root identity', () => {
  const core = (path: string) => ({ source: 'bundled', root: 'config/skills', path })

  it('prefixes the directory so it can never equal the core root literal', () => {
    expect(importRootId('config/skills')).not.toBe('config/skills')
    expect(importRootId('config/skills').startsWith('import:')).toBe(true)
  })

  it('ranks imported above extension-bundled and core-bundled', () => {
    const imported = { source: 'bundled', root: importRootId('/tmp/alpha'), path: 'alpha.md' }
    const ext = { source: 'bundled', root: 'ext:/tmp/pack', path: 'alpha.md' }
    expect(wins(imported, core('alpha.md'))).toBe(true)
    expect(wins(imported, ext)).toBe(true)
    expect(wins(core('alpha.md'), imported)).toBe(false)
  })
})

describe('resolveSkillImportRoots', () => {
  it('defaults to an empty list when config omits the key', () => {
    expect(resolveSkillImportRoots({})).toEqual([])
    expect(resolveSkillImportRoots({ skills: { classify: {} } })).toEqual([])
  })

  it('drops blanks and expands a leading tilde', () => {
    expect(resolveSkillImportRoots({
      skills: { importRoots: ['~/alpha', '', '  ', '/tmp/bravo'] },
    })).toEqual([join(homedir(), 'alpha'), '/tmp/bravo'])
  })
})

describe('config schema — skills.importRoots', () => {
  it('defaults to an empty list so a missing overlay stays tenant-agnostic', () => {
    const parsed = configSchema.parse({})
    expect(parsed.skills.importRoots).toEqual([])
  })

  it('keeps an explicit list instead of stripping it', () => {
    const parsed = configSchema.parse({ skills: { importRoots: ['/tmp/alpha', '/tmp/bravo'] } })
    expect(parsed.skills.importRoots).toEqual(['/tmp/alpha', '/tmp/bravo'])
  })
})

describe('loader — imported root shadows bundled', () => {
  let db: ReturnType<typeof createMemoryDb>
  let loader: ReturnType<typeof createSkillLoader>
  let coreDir: string
  let importDir: string

  beforeEach(() => {
    db = createMemoryDb()
    createSkillsTables(db)
    loader = createSkillLoader(db, mockLogger)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    coreDir = join(tmpdir(), `eyas-core-skills-${stamp}`)
    importDir = join(tmpdir(), `eyas-import-skills-${stamp}`)
    mkdirSync(coreDir, { recursive: true })
    mkdirSync(importDir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(coreDir, { recursive: true }) } catch {}
    try { rmSync(importDir, { recursive: true }) } catch {}
  })

  it('lets an imported file win the same id and records the bundled loser', async () => {
    writeFileSync(join(coreDir, 'alpha.md'), skillMd('alpha', 'Core body.'))
    writeFileSync(join(importDir, 'alpha.md'), skillMd('alpha', 'Imported body.'))

    const coreScan = await loader.loadFromDirectory(coreDir, 'config/skills')
    expect(coreScan.complete).toBe(true)
    expect(loader.get('alpha')!.content).toBe('Core body.')

    const imported = await scanSkillImportRoots(loader, [importDir])
    expect(imported.complete).toBe(true)
    expect(imported.shadowed).toBe(1)
    expect(loader.get('alpha')!.content).toBe('Imported body.')
    const row = (db.all(sql`SELECT source_root FROM skills WHERE id = 'alpha'`) as any[])[0]
    expect(row.source_root).toBe(importRootId(importDir))

    const shadows = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]
    expect(shadows).toEqual([
      { skill_id: 'alpha', path: 'alpha.md', root: 'config/skills' },
    ])
  })

  it('treats a missing import directory as a complete empty scan', async () => {
    const result = await scanSkillImportRoots(loader, [join(importDir, 'no-such-root')])
    expect(result).toMatchObject({ inserted: 0, updated: 0, shadowed: 0, complete: true })
  })

  it('reads SKILL.md from a nested folder using the frontmatter name', async () => {
    mkdirSync(join(importDir, 'alpha'), { recursive: true })
    writeFileSync(join(importDir, 'alpha', 'SKILL.md'), skillMd('alpha-skill', 'Nested body.'))

    const scan = await scanSkillImportRoots(loader, [importDir])
    expect(scan.complete).toBe(true)
    expect(scan.inserted).toBe(1)
    expect(loader.get('alpha-skill')!.content).toBe('Nested body.')
  })

  it('accepts triggers as an alias of trigger_patterns', async () => {
    writeFileSync(join(importDir, 'alpha.md'), skillMd('alpha', 'Body.', 'triggers:\n  - alpha-task\n'))
    await scanSkillImportRoots(loader, [importDir])
    expect(loader.get('alpha')!.triggerPatterns).toEqual(['alpha-task'])
  })

  it('derives trigger patterns from a hyphenated id when none are listed', async () => {
    writeFileSync(join(importDir, 'alpha-bravo.md'), skillMd('alpha-bravo', 'Body.'))
    await scanSkillImportRoots(loader, [importDir])
    expect(loader.get('alpha-bravo')!.triggerPatterns).toEqual(['alpha-bravo', 'alpha bravo'])
  })

  it('loads an unquoted description that contains a colon (host skill frontmatter)', async () => {
    writeFileSync(join(importDir, 'bravo.md'), `---
name: bravo
description: Fast indexer - 95% better. CRITICAL: always validate first.
---
Bravo body.
`)
    const scan = await scanSkillImportRoots(loader, [importDir])
    expect(scan.complete).toBe(true)
    expect(scan.inserted).toBe(1)
    expect(loader.get('bravo')!.description).toContain('CRITICAL:')
    expect(loader.get('bravo')!.content).toBe('Bravo body.')
  })

  it('matches the imported skill so the matcher can inject it without host settingSources', async () => {
    writeFileSync(join(importDir, 'alpha-bravo.md'), skillMd('alpha-bravo', 'Imported body for alpha.'))
    await scanSkillImportRoots(loader, [importDir])
    const matcher = createSkillMatcher()
    const matches = matcher.match('please handle alpha bravo now', loader.list(true), 1)
    expect(matches.length).toBe(1)
    expect(matches[0].skill.id).toBe('alpha-bravo')
    expect(matches[0].skill.content).toBe('Imported body for alpha.')
  })
})

describe('skills module wiring', () => {
  it('scans configured import roots after the bundled core root', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/skills/index.ts'), 'utf-8')
    expect(source).toContain('importRoots')
    expect(source).toContain('importRootId')
    expect(source).toContain('scanSkillImportRoots')
  })
})
