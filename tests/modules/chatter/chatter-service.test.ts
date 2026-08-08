import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createChatterService, type ChatterService } from '@modules/chatter/chatter-service'
import { createLocalBus } from '@core/bus/local-bus'
import type { EyasBus } from '@core/types'

const testDb = createTestDb('chatter')
let db: ReturnType<typeof testDb.open>
let bus: EyasBus
let svc: ChatterService

beforeEach(() => {
  db = testDb.open()
  bus = createLocalBus()
  svc = createChatterService(db, bus)
})

afterEach(() => {
  testDb.cleanup()
})

describe('postMessage', () => {
  it('should post a comment', () => {
    const msg = svc.postMessage('project.task', 'task-1', {
      messageType: 'comment',
      body: 'Hello world',
      authorId: 'user-1',
    })
    expect(msg.id).toBeTruthy()
    expect(msg.resModel).toBe('project.task')
    expect(msg.resId).toBe('task-1')
    expect(msg.messageType).toBe('comment')
    expect(msg.body).toBe('Hello world')
    expect(msg.authorId).toBe('user-1')
    expect(msg.parentId).toBeNull()
    expect(msg.createdAt).toBeTruthy()
  })

  it('should post a note', () => {
    const msg = svc.postMessage('project.task', 'task-1', {
      messageType: 'note',
      body: 'Internal note',
      authorId: 'user-1',
    })
    expect(msg.messageType).toBe('note')
    expect(msg.body).toBe('Internal note')
  })

  it('should post a reply with parentId', () => {
    const parent = svc.postMessage('project.task', 'task-1', {
      messageType: 'comment',
      body: 'Parent',
      authorId: 'user-1',
    })
    const reply = svc.postMessage('project.task', 'task-1', {
      messageType: 'comment',
      body: 'Reply',
      authorId: 'user-2',
      parentId: parent.id,
    })
    expect(reply.parentId).toBe(parent.id)
  })
})

describe('logTracking', () => {
  it('should create a tracking message with changes', () => {
    const msg = svc.logTracking('project.task', 'task-1', {
      changes: [
        { field: 'status', oldValue: 'draft', newValue: 'in_progress' },
        { field: 'priority', oldValue: 'low', newValue: 'high' },
      ],
      authorId: 'user-1',
    })
    expect(msg.messageType).toBe('tracking')
    expect(msg.body).toContain('status')
    expect(msg.body).toContain('priority')
    expect(msg.tracking).toHaveLength(2)
    expect(msg.tracking![0].field).toBe('status')
    expect(msg.tracking![0].oldValue).toBe('draft')
    expect(msg.tracking![0].newValue).toBe('in_progress')
    expect(msg.tracking![1].field).toBe('priority')
  })
})

describe('listMessages', () => {
  it('should return messages newest first', () => {
    svc.postMessage('project.task', 'task-1', { messageType: 'comment', body: 'First', authorId: 'u1' })
    svc.postMessage('project.task', 'task-1', { messageType: 'note', body: 'Second', authorId: 'u1' })
    svc.postMessage('project.task', 'task-1', { messageType: 'comment', body: 'Third', authorId: 'u2' })

    const msgs = svc.listMessages('project.task', 'task-1')
    expect(msgs).toHaveLength(3)
    // Newest first (context-rail activity feed)
    expect(msgs[0].body).toBe('Third')
    expect(msgs[1].body).toBe('Second')
    expect(msgs[2].body).toBe('First')
  })

  it('should filter by messageType', () => {
    svc.postMessage('project.task', 'task-1', { messageType: 'comment', body: 'Comment', authorId: 'u1' })
    svc.postMessage('project.task', 'task-1', { messageType: 'note', body: 'Note', authorId: 'u1' })

    const notes = svc.listMessages('project.task', 'task-1', { messageType: 'note' })
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('Note')
  })

  it('should isolate messages by resModel and resId', () => {
    svc.postMessage('project.task', 'task-1', { messageType: 'comment', body: 'Task 1', authorId: 'u1' })
    svc.postMessage('project.task', 'task-2', { messageType: 'comment', body: 'Task 2', authorId: 'u1' })
    svc.postMessage('sale.order', 'order-1', { messageType: 'comment', body: 'Order 1', authorId: 'u1' })

    expect(svc.listMessages('project.task', 'task-1')).toHaveLength(1)
    expect(svc.listMessages('project.task', 'task-2')).toHaveLength(1)
    expect(svc.listMessages('sale.order', 'order-1')).toHaveLength(1)
  })

  it('should load tracking changes for tracking messages', () => {
    svc.logTracking('project.task', 'task-1', {
      changes: [{ field: 'status', oldValue: 'draft', newValue: 'done' }],
      authorId: 'u1',
    })

    const msgs = svc.listMessages('project.task', 'task-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].messageType).toBe('tracking')
    expect(msgs[0].tracking).toHaveLength(1)
    expect(msgs[0].tracking![0].field).toBe('status')
  })

  it('should support limit and offset (newest first)', () => {
    for (let i = 0; i < 5; i++) {
      svc.postMessage('project.task', 'task-1', { messageType: 'comment', body: `Msg ${i}`, authorId: 'u1' })
    }

    // Newest-first: Msg 4, Msg 3, Msg 2, Msg 1, Msg 0
    const page = svc.listMessages('project.task', 'task-1', { limit: 2, offset: 1 })
    expect(page).toHaveLength(2)
    expect(page[0].body).toBe('Msg 3')
    expect(page[1].body).toBe('Msg 2')
  })

  it('should not persist runtime-only idle/working status tracking', () => {
    const msg = svc.logTracking('conversation', 'c1', {
      changes: [{ field: 'status', oldValue: 'idle', newValue: 'working' }],
      authorId: 'user',
    })
    expect(msg.tracking).toEqual([])
    expect(svc.listMessages('conversation', 'c1')).toHaveLength(0)
  })

  it('should drop runtime-only changes from bus record:updated', async () => {
    bus.emit('record:updated', {
      resModel: 'conversation',
      resId: 'c-runtime',
      changes: [{ field: 'status', oldValue: 'idle', newValue: 'working' }],
      authorId: 'user',
    })
    await new Promise(r => setTimeout(r, 10))
    expect(svc.listMessages('conversation', 'c-runtime')).toHaveLength(0)
  })
})

describe('followers', () => {
  it('should add and list followers', () => {
    svc.addFollower('project.task', 'task-1', 'user-1', ['comment', 'note'])
    svc.addFollower('project.task', 'task-1', 'user-2')

    const followers = svc.getFollowers('project.task', 'task-1')
    expect(followers).toHaveLength(2)
    expect(followers.find(f => f.userId === 'user-1')!.subtypes).toEqual(['comment', 'note'])
    expect(followers.find(f => f.userId === 'user-2')!.subtypes).toEqual([])
  })

  it('should ignore duplicate followers', () => {
    svc.addFollower('project.task', 'task-1', 'user-1')
    svc.addFollower('project.task', 'task-1', 'user-1') // duplicate

    const followers = svc.getFollowers('project.task', 'task-1')
    expect(followers).toHaveLength(1)
  })

  it('should remove a follower', () => {
    svc.addFollower('project.task', 'task-1', 'user-1')
    svc.addFollower('project.task', 'task-1', 'user-2')
    svc.removeFollower('project.task', 'task-1', 'user-1')

    const followers = svc.getFollowers('project.task', 'task-1')
    expect(followers).toHaveLength(1)
    expect(followers[0].userId).toBe('user-2')
  })
})

describe('bus integration', () => {
  it('should auto-create tracking message on record:updated event', async () => {
    bus.emit('record:updated', {
      resModel: 'project.task',
      resId: 'task-1',
      changes: [
        { field: 'stage', oldValue: 'Backlog', newValue: 'In Progress' },
      ],
      authorId: 'user-1',
    })

    // Wait for async bus handler
    await new Promise(r => setTimeout(r, 10))

    const msgs = svc.listMessages('project.task', 'task-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].messageType).toBe('tracking')
    expect(msgs[0].tracking).toHaveLength(1)
    expect(msgs[0].tracking![0].field).toBe('stage')
  })

  it('should not create tracking message when changes are empty', async () => {
    bus.emit('record:updated', {
      resModel: 'project.task',
      resId: 'task-1',
      changes: [],
      authorId: 'user-1',
    })

    await new Promise(r => setTimeout(r, 10))

    const msgs = svc.listMessages('project.task', 'task-1')
    expect(msgs).toHaveLength(0)
  })
})
