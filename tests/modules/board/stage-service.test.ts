import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService, type StageService } from '@modules/board/services/stage-service'

const testDb = createTestDb('board-stages')
let db: ReturnType<typeof testDb.open>
let stageSvc: StageService
let projectId: string

beforeEach(() => {
  db = testDb.open()
  const typeService = createProjectTypeService(db)
  const projectService = createProjectService(db, typeService)
  stageSvc = createStageService(db)
  const project = projectService.create({ name: 'Test Project' })
  projectId = project.id
})
afterEach(() => testDb.cleanup())

describe('StageService', () => {
  describe('create', () => {
    it('creates a stage in a project', () => {
      const stage = stageSvc.create({ projectId, name: 'New Stage' })
      expect(stage.id).toBeTruthy()
      expect(stage.name).toBe('New Stage')
      expect(stage.projectId).toBe(projectId)
    })
  })

  describe('listByProject', () => {
    it('returns stages ordered by sortOrder', () => {
      stageSvc.create({ projectId, name: 'C', sortOrder: 2 })
      stageSvc.create({ projectId, name: 'A', sortOrder: 0 })
      stageSvc.create({ projectId, name: 'B', sortOrder: 1 })
      const stages = stageSvc.listByProject(projectId)
      expect(stages.map(s => s.name)).toEqual(['A', 'B', 'C'])
    })
  })

  describe('update', () => {
    it('updates stage properties', () => {
      const stage = stageSvc.create({ projectId, name: 'Old' })
      stageSvc.update(stage.id, { name: 'New', color: '#ff0000', isClosed: true })
      const updated = stageSvc.get(stage.id)
      expect(updated!.name).toBe('New')
      expect(updated!.color).toBe('#ff0000')
      expect(updated!.isClosed).toBe(true)
    })
  })

  // auto_assignee_id was insert-only dead: the column existed but no input,
  // mapper, or update path ever touched it, so a stage could never actually
  // name the agent that picks its cards up.
  describe('autoAssigneeId', () => {
    it('defaults to null', () => {
      const stage = stageSvc.create({ projectId, name: 'Plain' })
      expect(stage.autoAssigneeId).toBeNull()
    })

    it('round-trips through create, get, and listByProject', () => {
      const stage = stageSvc.create({ projectId, name: 'Bot', autoAssigneeId: 'agent-7' })
      expect(stage.autoAssigneeId).toBe('agent-7')
      expect(stageSvc.get(stage.id)!.autoAssigneeId).toBe('agent-7')
      expect(stageSvc.listByProject(projectId)[0].autoAssigneeId).toBe('agent-7')
    })

    it('is settable and clearable through update', () => {
      const stage = stageSvc.create({ projectId, name: 'Bot' })
      stageSvc.update(stage.id, { autoAssigneeId: 'agent-7' })
      expect(stageSvc.get(stage.id)!.autoAssigneeId).toBe('agent-7')

      stageSvc.update(stage.id, { autoAssigneeId: null })
      expect(stageSvc.get(stage.id)!.autoAssigneeId).toBeNull()
    })

    it('is left alone by an unrelated update', () => {
      const stage = stageSvc.create({ projectId, name: 'Bot', autoAssigneeId: 'agent-7' })
      stageSvc.update(stage.id, { name: 'Renamed' })
      expect(stageSvc.get(stage.id)!.autoAssigneeId).toBe('agent-7')
    })
  })

  describe('reorder', () => {
    it('reorders stages by id array', () => {
      const a = stageSvc.create({ projectId, name: 'A', sortOrder: 0 })
      const b = stageSvc.create({ projectId, name: 'B', sortOrder: 1 })
      const c = stageSvc.create({ projectId, name: 'C', sortOrder: 2 })

      stageSvc.reorder(projectId, [c.id, a.id, b.id])

      const stages = stageSvc.listByProject(projectId)
      expect(stages.map(s => s.name)).toEqual(['C', 'A', 'B'])
    })
  })

  describe('delete', () => {
    it('deletes a stage', () => {
      const stage = stageSvc.create({ projectId, name: 'ToDelete' })
      stageSvc.delete(stage.id)
      expect(stageSvc.get(stage.id)).toBeNull()
    })
  })
})
