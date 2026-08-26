// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../../helpers/test-db.js'
import { createConversationService } from '@modules/conversations/conversation-service.js'
import { createProjectTypeService } from '@modules/board/services/project-type-service.js'
import { createProjectService } from '@modules/board/services/project-service.js'

const testDb = createTestDb('working-directories-inherit')

describe('conversation working directory inheritance', () => {
  let dirA: string
  let dirB: string
  let db: ReturnType<typeof testDb.open>
  let conversations: ReturnType<typeof createConversationService>
  let projects: ReturnType<typeof createProjectService>

  beforeEach(() => {
    dirA = mkdtempSync(join(tmpdir(), 'eyas-inh-a-'))
    dirB = mkdtempSync(join(tmpdir(), 'eyas-inh-b-'))
    db = testDb.open()
    conversations = createConversationService(db)
    projects = createProjectService(db, createProjectTypeService(db))
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  })

  it('stores and returns working directories on a conversation', () => {
    const conv = conversations.create({ userId: 'u1', title: 't' })
    conversations.update(conv.id, { workingDirectories: [dirA, dirB] })
    const got = conversations.get(conv.id)
    expect(got?.workingDirectories).toEqual([dirA, dirB])
  })

  it('child conversation inherits parent working directories', () => {
    const parent = conversations.create({ userId: 'u1', title: 'parent' })
    conversations.update(parent.id, { workingDirectories: [dirA] })
    const child = conversations.createSubConversation({
      title: 'child',
      goalDescription: 'do',
      parentConversationId: parent.id,
    })
    expect(child.workingDirectories).toEqual([dirA])
    expect(conversations.get(child.id)?.workingDirectories).toEqual([dirA])
  })

  it('project can persist a default working directory list', () => {
    const project = projects.create({
      name: 'Odoo work',
      workingDirectories: [dirA, dirB],
    })
    expect(projects.get(project.id)?.workingDirectories).toEqual([dirA, dirB])
  })
})
