import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createMemoryDb } from '../../helpers/test-db'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// skill-loader.ts obtains readdir via `await import('fs/promises')` at call time,
// which resolves through this same mocked module record. `readdir` is wrapped as
// a spy that calls through to the real implementation by default, so only the one
// test below that sets `mockRejectedValueOnce` observes a failure — every other
// test in this file still exercises the real filesystem.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

let db: ReturnType<typeof createMemoryDb>
let loader: ReturnType<typeof createSkillLoader>
let skillsDir: string

const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function createSkillsTable(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS skills (
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
  database.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL,
    path TEXT NOT NULL,
    root TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    UNIQUE(skill_id, path, root)
  )`)
}

beforeEach(() => {
  db = createMemoryDb()
  createSkillsTable(db)
  loader = createSkillLoader(db, mockLogger)
  skillsDir = join(tmpdir(), `eyas-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(skillsDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(skillsDir, { recursive: true }) } catch {}
})

describe('SkillLoader', () => {
  describe('loadFromDirectory', () => {
    it('loads markdown files with YAML frontmatter', async () => {
      const content = `---
name: Test Skill
description: A test skill
trigger_patterns:
  - test something
  - run test
capabilities:
  - testing
version: "2.0.0"
---
This is the skill body content.`
      writeFileSync(join(skillsDir, 'test-skill.md'), content)

      const result = await loader.loadFromDirectory(skillsDir)
      expect(result).toMatchObject({ inserted: 1, updated: 0, shadowed: 0, complete: true })

      const skills = loader.list()
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('Test Skill')
      expect(skills[0].description).toBe('A test skill')
      expect(skills[0].triggerPatterns).toEqual(['test something', 'run test'])
      expect(skills[0].capabilities).toEqual(['testing'])
      expect(skills[0].version).toBe('2.0.0')
      expect(skills[0].content).toBe('This is the skill body content.')
      expect(skills[0].source).toBe('bundled')
      expect(skills[0].enabled).toBe(true)
    })

    it('uses filename as id when no id/name in frontmatter', async () => {
      const content = `---
description: minimal
---
Body here.`
      writeFileSync(join(skillsDir, 'my-skill.md'), content)

      await loader.loadFromDirectory(skillsDir)
      const skill = loader.get('my-skill')
      expect(skill).not.toBeNull()
      expect(skill!.id).toBe('my-skill')
    })

    it('uses frontmatter id over filename', async () => {
      const content = `---
id: custom-id
name: Custom Skill
---
Content.`
      writeFileSync(join(skillsDir, 'filename.md'), content)

      await loader.loadFromDirectory(skillsDir)
      const skill = loader.get('custom-id')
      expect(skill).not.toBeNull()
      expect(skill!.name).toBe('Custom Skill')
    })

    it('skips non-markdown files', async () => {
      writeFileSync(join(skillsDir, 'readme.txt'), 'not a skill')
      writeFileSync(join(skillsDir, 'data.json'), '{}')

      const result = await loader.loadFromDirectory(skillsDir)
      expect(result).toMatchObject({ inserted: 0, updated: 0, complete: true })
    })

    it('skips files without frontmatter', async () => {
      writeFileSync(join(skillsDir, 'no-frontmatter.md'), 'Just plain markdown without frontmatter.')

      const result = await loader.loadFromDirectory(skillsDir)
      expect(result).toMatchObject({ inserted: 0, updated: 0, complete: true })
    })

    it('updates bundled skills on re-load', async () => {
      // Use explicit id so the id stays stable across updates
      const v1 = `---
id: evolving-skill
name: Evolving Skill
version: "1.0.0"
---
Version 1 body.`
      writeFileSync(join(skillsDir, 'evolving.md'), v1)
      await loader.loadFromDirectory(skillsDir)

      const v2 = `---
id: evolving-skill
name: Evolving Skill Updated
version: "2.0.0"
---
Version 2 body.`
      writeFileSync(join(skillsDir, 'evolving.md'), v2)
      const result = await loader.loadFromDirectory(skillsDir)
      expect(result).toMatchObject({ inserted: 0, updated: 1, complete: true })

      const skill = loader.get('evolving-skill')
      expect(skill).not.toBeNull()
      expect(skill!.name).toBe('Evolving Skill Updated')
      expect(skill!.version).toBe('2.0.0')
      expect(skill!.content).toBe('Version 2 body.')
    })

    it('does not overwrite user-created skills with same id', async () => {
      // Create a user skill first
      loader.create({ name: 'User Skill', content: 'user content' })
      const userSkill = loader.list()[0]

      // Write a bundled skill with same id
      const content = `---
id: ${userSkill.id}
name: Bundled Override
---
Bundled content.`
      writeFileSync(join(skillsDir, 'override.md'), content)
      await loader.loadFromDirectory(skillsDir)

      const skill = loader.get(userSkill.id)
      expect(skill!.source).toBe('user')
      expect(skill!.content).toBe('user content')
    })

    it('records the shadowed bundled file when a user skill shadows it', async () => {
      // The user skill still wins (see previous test) — but the bundled file it
      // shadows must be recorded so the inventory can explain why editing that
      // .md file has no effect.
      loader.create({ name: 'User Skill', content: 'user content' })
      const userSkill = loader.list()[0]

      const content = `---
id: ${userSkill.id}
name: Bundled Override
---
Bundled content.`
      writeFileSync(join(skillsDir, 'override.md'), content)
      const result = await loader.loadFromDirectory(skillsDir)

      expect(result.shadowed).toBe(1)
      const rows = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]
      expect(rows).toEqual([{ skill_id: userSkill.id, path: 'override.md', root: 'config/skills' }])
    })

    it('reports a missing directory as complete with no work', async () => {
      const r = await loader.loadFromDirectory('/tmp/nonexistent-skills-dir-xyz')
      expect(r).toMatchObject({ inserted: 0, updated: 0, shadowed: 0, complete: true })
    })

    it('marks the scan incomplete when listing the directory fails for a reason other than a missing directory', async () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      vi.mocked(readdir).mockRejectedValueOnce(err as never)

      const r = await loader.loadFromDirectory(skillsDir)
      expect(r).toMatchObject({ inserted: 0, updated: 0, complete: false })
      expect(r.error).toBeTruthy()
    })

    it('marks the scan incomplete when a read fails mid-way', async () => {
      // A directory sharing the '.md' suffix is picked up by the recursive scan
      // like a file, but reading it fails deterministically (EISDIR) — no
      // reliance on chmod, which permission-agnostic CI runners can ignore.
      writeFileSync(join(skillsDir, 'good.md'), '---\nname: Good\n---\nBody.')
      mkdirSync(join(skillsDir, 'broken.md'))

      const r = await loader.loadFromDirectory(skillsDir)
      expect(r.complete).toBe(false)
      expect(r.error).toBeTruthy()
      // The unreadable entry must not abort the loop — the good file is still loaded.
      expect(r.inserted).toBe(1)
    })

    it('counts inserted and updated separately', async () => {
      writeFileSync(join(skillsDir, 'one.md'), '---\nid: one\nname: One\n---\nBody one.')
      writeFileSync(join(skillsDir, 'two.md'), '---\nid: two\nname: Two\n---\nBody two.')

      const first = await loader.loadFromDirectory(skillsDir)
      expect(first).toMatchObject({ inserted: 2, updated: 0 })
      const second = await loader.loadFromDirectory(skillsDir)
      expect(second).toMatchObject({ inserted: 0, updated: 2 })
    })

    it('records where each skill came from', async () => {
      writeFileSync(join(skillsDir, 'alpha.md'), '---\nid: alpha\nname: Alpha\n---\nBody.')

      await loader.loadFromDirectory(skillsDir, 'config/skills')
      const row = (db.all(sql`SELECT source_path, source_root, last_seen_at FROM skills WHERE id = 'alpha'`) as any[])[0]
      expect(row.source_path).toBe('alpha.md')
      expect(row.source_root).toBe('config/skills')
      expect(row.last_seen_at).toBeTruthy()
    })
  })

  describe('CRUD operations', () => {
    it('creates a user skill', () => {
      const skill = loader.create({
        name: 'My Custom Skill',
        description: 'Does custom things',
        triggerPatterns: ['do custom', 'custom action'],
        capabilities: ['automation'],
        content: 'Custom skill instructions.',
      })

      expect(skill.name).toBe('My Custom Skill')
      expect(skill.source).toBe('user')
      expect(skill.enabled).toBe(true)
      expect(skill.triggerPatterns).toEqual(['do custom', 'custom action'])
    })

    it('creates a skill with minimal input', () => {
      const skill = loader.create({ name: 'Minimal', content: 'body' })
      expect(skill.name).toBe('Minimal')
      expect(skill.description).toBe('')
      expect(skill.triggerPatterns).toEqual([])
      expect(skill.capabilities).toEqual([])
    })

    it('gets a skill by id', () => {
      const created = loader.create({ name: 'Findable', content: 'findable content' })
      const found = loader.get(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Findable')
    })

    it('returns null for nonexistent skill', () => {
      expect(loader.get('nonexistent-id')).toBeNull()
    })

    it('updates a skill description and content in place (forge apply path)', () => {
      const created = loader.create({ name: 'Patchable', description: 'Old desc', content: 'old body' })
      const updated = loader.update(created.id, { description: 'New desc' })
      expect(updated).not.toBeNull()
      expect(updated!.description).toBe('New desc')
      expect(updated!.content).toBe('old body') // untouched field preserved
      expect(loader.get(created.id)!.description).toBe('New desc') // persisted
    })

    it('update returns null for a nonexistent skill', () => {
      expect(loader.update('nonexistent-id', { description: 'x' })).toBeNull()
    })

    it('lists all skills', () => {
      loader.create({ name: 'Skill A', content: 'a' })
      loader.create({ name: 'Skill B', content: 'b' })

      const all = loader.list()
      expect(all).toHaveLength(2)
    })

    it('lists enabled skills only', () => {
      const skill = loader.create({ name: 'Will Disable', content: 'x' })
      loader.create({ name: 'Stays Enabled', content: 'y' })
      loader.toggle(skill.id)

      const enabled = loader.list(true)
      expect(enabled).toHaveLength(1)
      expect(enabled[0].name).toBe('Stays Enabled')
    })

    it('lists disabled skills only', () => {
      const skill = loader.create({ name: 'Will Disable', content: 'x' })
      loader.create({ name: 'Stays Enabled', content: 'y' })
      loader.toggle(skill.id)

      const disabled = loader.list(false)
      expect(disabled).toHaveLength(1)
      expect(disabled[0].name).toBe('Will Disable')
    })

    it('toggles skill enabled/disabled', () => {
      const skill = loader.create({ name: 'Toggler', content: 'toggle' })
      expect(skill.enabled).toBe(true)

      loader.toggle(skill.id)
      expect(loader.get(skill.id)!.enabled).toBe(false)

      loader.toggle(skill.id)
      expect(loader.get(skill.id)!.enabled).toBe(true)
    })

    it('toggle does nothing for nonexistent skill', () => {
      // Should not throw
      loader.toggle('nonexistent')
    })

    describe('setEnabled', () => {
      beforeEach(() => {
        const now = new Date().toISOString()
        db.run(sql`INSERT INTO skills (id, name, description, trigger_patterns, capabilities, content, skill_type, source, enabled, created_at, updated_at)
          VALUES ('alpha', 'Alpha', '', '[]', '[]', 'body', 'knowledge', 'bundled', 1, ${now}, ${now})`)
      })

      it('is idempotent', () => {
        loader.setEnabled('alpha', false, 'dormant', 'detector')
        const first = loader.get('alpha')
        loader.setEnabled('alpha', false, 'dormant', 'detector')
        expect(loader.get('alpha')!.enabled).toBe(false)
        expect(loader.get('alpha')!.disabledReason).toBe('dormant')
        expect(first!.enabled).toBe(false)
      })

      it('clears disable metadata on re-enable', () => {
        loader.setEnabled('alpha', false, 'orphan', 'detector')
        loader.setEnabled('alpha', true)
        const s = loader.get('alpha')!
        expect(s.enabled).toBe(true)
        expect(s.disabledReason).toBeUndefined()
      })

      it('toggle still flips', () => {
        const before = loader.get('alpha')!.enabled
        loader.toggle('alpha')
        expect(loader.get('alpha')!.enabled).toBe(!before)
      })
    })

    it('deletes user-created skills', () => {
      const skill = loader.create({ name: 'Deletable', content: 'bye' })
      loader.delete(skill.id)
      expect(loader.get(skill.id)).toBeNull()
    })

    it('does not delete bundled skills', async () => {
      const content = `---
name: Bundled
---
Protected content.`
      writeFileSync(join(skillsDir, 'bundled.md'), content)
      await loader.loadFromDirectory(skillsDir)

      const skill = loader.list()[0]
      expect(skill.source).toBe('bundled')

      loader.delete(skill.id)
      // Should still exist since source is 'bundled'
      expect(loader.get(skill.id)).not.toBeNull()
    })
  })
})
