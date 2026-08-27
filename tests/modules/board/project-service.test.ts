import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService, type ProjectService } from '@modules/board/services/project-service'

const testDb = createTestDb('board-projects')
let db: ReturnType<typeof testDb.open>
let svc: ProjectService

beforeEach(() => {
  db = testDb.open()
  const typeService = createProjectTypeService(db)
  svc = createProjectService(db, typeService)
})
afterEach(() => testDb.cleanup())

describe('ProjectService', () => {
  describe('create', () => {
    it('creates a standalone project without type', () => {
      const project = svc.create({ name: 'My Project' })
      expect(project.id).toBeTruthy()
      expect(project.name).toBe('My Project')
      expect(project.typeId).toBeNull()
    })

    it('creates a project from type with auto-generated stages', () => {
      const typeService = createProjectTypeService(db)
      const pt = typeService.create({ name: 'Bug Tracker', defaultStages: ['New', 'In Progress', 'Resolved'] })

      const project = svc.create({ name: 'Bugs Q2', typeId: pt.id })
      expect(project.typeId).toBe(pt.id)

      const withStages = svc.getWithStages(project.id)
      expect(withStages).not.toBeNull()
      expect(withStages!.stages).toHaveLength(3)
      expect(withStages!.stages[0].name).toBe('New')
      expect(withStages!.stages[0].sortOrder).toBe(0)
      expect(withStages!.stages[1].name).toBe('In Progress')
      expect(withStages!.stages[1].sortOrder).toBe(1)
      expect(withStages!.stages[2].name).toBe('Resolved')
      expect(withStages!.stages[2].sortOrder).toBe(2)
    })
  })

  describe('list', () => {
    it('returns all projects', () => {
      svc.create({ name: 'A' })
      svc.create({ name: 'B' })
      expect(svc.list()).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('updates project fields', () => {
      const p = svc.create({ name: 'Old' })
      svc.update(p.id, { name: 'New', color: '#00ff00' })
      const updated = svc.get(p.id)
      expect(updated!.name).toBe('New')
      expect(updated!.color).toBe('#00ff00')
    })
  })

  describe('delete', () => {
    it('deletes project and cascades stages', () => {
      const typeService = createProjectTypeService(db)
      const pt = typeService.create({ name: 'T', defaultStages: ['A', 'B'] })
      const p = svc.create({ name: 'P', typeId: pt.id })

      svc.delete(p.id)
      expect(svc.get(p.id)).toBeNull()
      expect(svc.getWithStages(p.id)).toBeNull()
    })
  })

  describe('seed protection', () => {
    it('prevents deleting a seed project', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, type_id, source, sort_order, created_at, updated_at)
        VALUES ('test-seed', 'Seed Project', null, 'seed', 0, ${now}, ${now})`)
      expect(() => svc.delete('test-seed')).toThrow('Cannot delete system resource')
      expect(svc.get('test-seed')).not.toBeNull()
    })

    it('prevents updating a seed project', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, type_id, source, sort_order, created_at, updated_at)
        VALUES ('test-seed-upd', 'Seed Project', null, 'seed', 0, ${now}, ${now})`)
      expect(() => svc.update('test-seed-upd', { name: 'Changed' })).toThrow('Cannot modify system resource')
      expect(svc.get('test-seed-upd')!.name).toBe('Seed Project')
    })

    it('allows configuring a seed project (agent/prompt/color) without throwing', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, type_id, source, sort_order, created_at, updated_at)
        VALUES ('test-seed-cfg', 'Seed Project', null, 'seed', 0, ${now}, ${now})`)
      // Config fields must persist on seed projects (UI-wired default agent etc.)
      expect(() => svc.update('test-seed-cfg', { defaultAgentId: 'a1', prompt: 'P', color: '#123456' })).not.toThrow()
      const updated = svc.get('test-seed-cfg')!
      expect(updated.defaultAgentId).toBe('a1')
      expect(updated.prompt).toBe('P')
      expect(updated.color).toBe('#123456')
      // Identity/structural fields stay locked
      expect(() => svc.update('test-seed-cfg', { sortOrder: 5 })).toThrow('Cannot modify system resource')
    })

    it('allows deleting a user project', () => {
      const p = svc.create({ name: 'User Project' })
      svc.delete(p.id)
      expect(svc.get(p.id)).toBeNull()
    })
  })
})
