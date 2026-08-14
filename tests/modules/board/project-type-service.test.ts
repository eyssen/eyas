import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService, type ProjectTypeService } from '@modules/board/services/project-type-service'

const testDb = createTestDb('board-project-types')
let db: ReturnType<typeof testDb.open>
let svc: ProjectTypeService

beforeEach(() => {
  db = testDb.open()
  svc = createProjectTypeService(db)
})
afterEach(() => testDb.cleanup())

describe('ProjectTypeService', () => {
  describe('create', () => {
    it('creates a project type with defaults', () => {
      const pt = svc.create({ name: 'Bug Tracker' })
      expect(pt.id).toBeTruthy()
      expect(pt.name).toBe('Bug Tracker')
      expect(pt.defaultStages).toEqual(['Backlog', 'In Progress', 'Done'])
      expect(pt.defaultPriority).toBe('normal')
    })

    it('creates with custom stages and priority', () => {
      const pt = svc.create({
        name: 'Custom',
        defaultStages: ['Todo', 'Doing', 'Review', 'Done'],
        defaultPriority: 'high',
        prompt: 'You are a project manager',
        color: '#ff0000',
        icon: 'bug',
      })
      expect(pt.defaultStages).toEqual(['Todo', 'Doing', 'Review', 'Done'])
      expect(pt.defaultPriority).toBe('high')
      expect(pt.prompt).toBe('You are a project manager')
    })
  })

  describe('list', () => {
    it('returns all project types', () => {
      svc.create({ name: 'Type A' })
      svc.create({ name: 'Type B' })
      expect(svc.list()).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('returns a project type by id', () => {
      const created = svc.create({ name: 'Test' })
      const found = svc.get(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Test')
    })

    it('returns null for non-existent id', () => {
      expect(svc.get('nonexistent')).toBeNull()
    })
  })

  describe('update', () => {
    it('updates name and prompt', () => {
      const pt = svc.create({ name: 'Old' })
      svc.update(pt.id, { name: 'New', prompt: 'Updated prompt' })
      const updated = svc.get(pt.id)
      expect(updated!.name).toBe('New')
      expect(updated!.prompt).toBe('Updated prompt')
    })
  })

  describe('delete', () => {
    it('deletes a project type', () => {
      const pt = svc.create({ name: 'ToDelete' })
      svc.delete(pt.id)
      expect(svc.get(pt.id)).toBeNull()
    })
  })

  describe('seed protection', () => {
    it('prevents deleting a seed project type', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, source, created_at)
        VALUES ('test-seed', 'Seed Type', '', '["Done"]', 'normal', 'seed', ${now})`)
      expect(() => svc.delete('test-seed')).toThrow('Cannot delete system resource')
      expect(svc.get('test-seed')).not.toBeNull()
    })

    it('prevents updating a seed project type', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, source, created_at)
        VALUES ('test-seed-upd', 'Seed Type', '', '["Done"]', 'normal', 'seed', ${now})`)
      expect(() => svc.update('test-seed-upd', { name: 'Changed' })).toThrow('Cannot modify system resource')
      expect(svc.get('test-seed-upd')!.name).toBe('Seed Type')
    })

    it('allows deleting a user project type', () => {
      const pt = svc.create({ name: 'User Type' })
      svc.delete(pt.id)
      expect(svc.get(pt.id)).toBeNull()
    })
  })
})
