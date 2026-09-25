import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createActivityService, type ActivityService } from '@modules/activity/activity-service'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

const testDb = createTestDb('activity')
let db: ReturnType<typeof testDb.open>
let svc: ActivityService

// Seed type IDs for reuse
let todoTypeId: string
let reviewTypeId: string
let followUpTypeId: string

function seedTypes() {
  todoTypeId = generateId()
  reviewTypeId = generateId()
  followUpTypeId = generateId()

  db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, delay_days, delay_unit, sort_order)
    VALUES (${todoTypeId}, 'To Do', '✅', 'default', 'normal', 0, 'days', 0)`)
  db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, delay_days, delay_unit, sort_order)
    VALUES (${reviewTypeId}, 'Code Review', '🔍', 'default', 'warning', 3, 'days', 1)`)
  db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, delay_days, delay_unit, trigger_next_type_id, sort_order)
    VALUES (${followUpTypeId}, 'Follow Up', '📌', 'default', 'normal', 7, 'days', ${reviewTypeId}, 2)`)
}

beforeEach(() => {
  db = testDb.open()
  seedTypes()
  svc = createActivityService(db)
})
afterEach(() => testDb.cleanup())

describe('ActivityService', () => {
  describe('listTypes', () => {
    it('returns all activity types sorted by sort_order', () => {
      const types = svc.listTypes()
      expect(types).toHaveLength(3)
      expect(types[0].name).toBe('To Do')
      expect(types[1].name).toBe('Code Review')
      expect(types[2].name).toBe('Follow Up')
    })

    it('maps all fields correctly', () => {
      const types = svc.listTypes()
      const todo = types[0]
      expect(todo.id).toBe(todoTypeId)
      expect(todo.icon).toBe('✅')
      expect(todo.category).toBe('default')
      expect(todo.decoration).toBe('normal')
      expect(todo.delayDays).toBe(0)
      expect(todo.delayUnit).toBe('days')
      expect(todo.triggerNextTypeId).toBeNull()
      expect(todo.suggestNextTypeId).toBeNull()
      expect(todo.sortOrder).toBe(0)
    })

    it('maps trigger_next_type_id', () => {
      const types = svc.listTypes()
      const followUp = types.find(t => t.name === 'Follow Up')!
      expect(followUp.triggerNextTypeId).toBe(reviewTypeId)
    })
  })

  describe('schedule', () => {
    it('creates a planned activity (future deadline)', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const deadline = tomorrow.toISOString().slice(0, 10)

      const activity = svc.schedule({
        typeId: todoTypeId,
        resModel: 'conversation',
        resId: 'conv-1',
        userId: 'user-1',
        createdById: 'user-1',
        dateDeadline: deadline,
      })

      expect(activity.id).toBeTruthy()
      expect(activity.typeId).toBe(todoTypeId)
      expect(activity.typeName).toBe('To Do')
      expect(activity.typeIcon).toBe('✅')
      expect(activity.typeDecoration).toBe('normal')
      expect(activity.resModel).toBe('conversation')
      expect(activity.resId).toBe('conv-1')
      expect(activity.state).toBe('planned')
      expect(activity.automated).toBe(false)
      expect(activity.doneAt).toBeNull()
    })

    it('creates an overdue activity (past deadline)', () => {
      const past = new Date()
      past.setDate(past.getDate() - 3)
      const deadline = past.toISOString().slice(0, 10)

      const activity = svc.schedule({
        typeId: todoTypeId,
        resModel: 'conversation',
        resId: 'conv-1',
        userId: 'user-1',
        createdById: 'user-1',
        dateDeadline: deadline,
      })

      expect(activity.state).toBe('overdue')
    })

    it('creates a today activity', () => {
      const today = new Date().toISOString().slice(0, 10)

      const activity = svc.schedule({
        typeId: todoTypeId,
        resModel: 'conversation',
        resId: 'conv-1',
        userId: 'user-1',
        createdById: 'user-1',
        dateDeadline: today,
      })

      expect(activity.state).toBe('today')
    })

    it('schedule with summary and note', () => {
      const activity = svc.schedule({
        typeId: reviewTypeId,
        resModel: 'task',
        resId: 'task-1',
        summary: 'Review PR #42',
        note: 'Check security implications',
        userId: 'user-2',
        createdById: 'user-1',
        dateDeadline: new Date().toISOString().slice(0, 10),
      })

      expect(activity.summary).toBe('Review PR #42')
      expect(activity.note).toBe('Check security implications')
      expect(activity.userId).toBe('user-2')
      expect(activity.createdById).toBe('user-1')
    })
  })

  describe('listByRecord', () => {
    it('returns activities for a specific record', () => {
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      svc.schedule({ typeId: reviewTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-02' })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c2', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })

      const list = svc.listByRecord('conv', 'c1')
      expect(list).toHaveLength(2)
      expect(list.every(a => a.resId === 'c1')).toBe(true)
    })

    it('excludes done activities', () => {
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      svc.schedule({ typeId: reviewTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-02' })
      svc.markDone(a.id)

      const list = svc.listByRecord('conv', 'c1')
      expect(list).toHaveLength(1)
    })

    it('orders by deadline', () => {
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-06-01' })
      svc.schedule({ typeId: reviewTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })

      const list = svc.listByRecord('conv', 'c1')
      expect(list[0].dateDeadline).toBe('2099-01-01')
      expect(list[1].dateDeadline).toBe('2099-06-01')
    })
  })

  describe('listByUser', () => {
    it('returns activities for a specific user', () => {
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c2', userId: 'u2', createdById: 'u1', dateDeadline: '2099-01-01' })

      const list = svc.listByUser('u1')
      expect(list).toHaveLength(1)
      expect(list[0].userId).toBe('u1')
    })

    it('excludes done activities', () => {
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      svc.schedule({ typeId: reviewTypeId, resModel: 'conv', resId: 'c2', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-02' })
      svc.markDone(a.id)

      const list = svc.listByUser('u1')
      expect(list).toHaveLength(1)
    })
  })

  describe('markDone', () => {
    it('marks activity as done with feedback', () => {
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      const done = svc.markDone(a.id, 'Completed successfully')

      expect(done.doneAt).toBeTruthy()
      expect(done.feedback).toBe('Completed successfully')
    })

    it('marks activity as done without feedback', () => {
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      const done = svc.markDone(a.id)

      expect(done.doneAt).toBeTruthy()
      expect(done.feedback).toBeNull()
    })

    it('throws if activity not found', () => {
      expect(() => svc.markDone('nonexistent')).toThrow('Activity not found')
    })

    it('chains: creates next activity when type has triggerNextTypeId', () => {
      // followUpTypeId triggers reviewTypeId (delay 3 days)
      const a = svc.schedule({
        typeId: followUpTypeId,
        resModel: 'conv',
        resId: 'c1',
        userId: 'u1',
        createdById: 'u1',
        dateDeadline: '2099-01-01',
      })

      svc.markDone(a.id)

      // Should have created a new Code Review activity
      const recordActivities = svc.listByRecord('conv', 'c1')
      expect(recordActivities).toHaveLength(1)
      expect(recordActivities[0].typeId).toBe(reviewTypeId)
      expect(recordActivities[0].typeName).toBe('Code Review')
      expect(recordActivities[0].automated).toBe(true)
    })

    it('does not chain when type has no triggerNextTypeId', () => {
      const a = svc.schedule({
        typeId: todoTypeId,
        resModel: 'conv',
        resId: 'c1',
        userId: 'u1',
        createdById: 'u1',
        dateDeadline: '2099-01-01',
      })

      svc.markDone(a.id)

      const recordActivities = svc.listByRecord('conv', 'c1')
      expect(recordActivities).toHaveLength(0)
    })
  })

  describe('markCancel', () => {
    it('deletes the activity', () => {
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2099-01-01' })
      svc.markCancel(a.id)

      const list = svc.listByRecord('conv', 'c1')
      expect(list).toHaveLength(0)
    })

    it('does not throw for nonexistent activity', () => {
      expect(() => svc.markCancel('nonexistent')).not.toThrow()
    })
  })

  describe('getStats', () => {
    it('returns correct counts', () => {
      const today = new Date().toISOString().slice(0, 10)
      const past = new Date()
      past.setDate(past.getDate() - 2)
      const pastStr = past.toISOString().slice(0, 10)
      const future = new Date()
      future.setDate(future.getDate() + 5)
      const futureStr = future.toISOString().slice(0, 10)

      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: pastStr })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c2', userId: 'u1', createdById: 'u1', dateDeadline: pastStr })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c3', userId: 'u1', createdById: 'u1', dateDeadline: today })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c4', userId: 'u1', createdById: 'u1', dateDeadline: futureStr })

      const stats = svc.getStats('u1')
      expect(stats.overdue).toBe(2)
      expect(stats.today).toBe(1)
      expect(stats.planned).toBe(1)
    })

    it('excludes done activities from stats', () => {
      const today = new Date().toISOString().slice(0, 10)
      const a = svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: today })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c2', userId: 'u1', createdById: 'u1', dateDeadline: today })
      svc.markDone(a.id)

      const stats = svc.getStats('u1')
      expect(stats.today).toBe(1)
    })

    it('returns zeros for user with no activities', () => {
      const stats = svc.getStats('nobody')
      expect(stats.overdue).toBe(0)
      expect(stats.today).toBe(0)
      expect(stats.planned).toBe(0)
    })

    it('only counts activities for the specified user', () => {
      const today = new Date().toISOString().slice(0, 10)
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: today })
      svc.schedule({ typeId: todoTypeId, resModel: 'conv', resId: 'c2', userId: 'u2', createdById: 'u1', dateDeadline: today })

      const stats = svc.getStats('u1')
      expect(stats.today).toBe(1)
    })
  })
})
