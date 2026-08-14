import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createMemoryDb } from '../../helpers/test-db'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

      const count = await loader.loadFromDirectory(skillsDir)
      expect(count).toBe(1)

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

      const count = await loader.loadFromDirectory(skillsDir)
      expect(count).toBe(0)
    })

    it('skips files without frontmatter', async () => {
      writeFileSync(join(skillsDir, 'no-frontmatter.md'), 'Just plain markdown without frontmatter.')

      const count = await loader.loadFromDirectory(skillsDir)
      expect(count).toBe(0)
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
      const count = await loader.loadFromDirectory(skillsDir)
      expect(count).toBe(1)

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

    it('returns 0 for nonexistent directory', async () => {
      const count = await loader.loadFromDirectory('/tmp/nonexistent-skills-dir-xyz')
      expect(count).toBe(0)
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
