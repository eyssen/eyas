// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationService } from '@modules/conversations/conversation-service.js'
import { createConversationRoutes } from '@modules/conversations/routes.js'
import { createProjectTypeService } from '@modules/board/services/project-type-service.js'
import { createProjectService } from '@modules/board/services/project-service.js'
import { createModelGateway } from '@modules/model/gateway.js'
import { createProviderConfigService } from '@modules/model/provider-config-service.js'
import { errorHandler } from '@core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import { createPermissionRegistry } from '@modules/permissions/registry.js'

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
      name: 'alpha work',
      workingDirectories: [dirA, dirB],
    })
    expect(projects.get(project.id)?.workingDirectories).toEqual([dirA, dirB])
  })

  it('stores named working directories on a type and a project', () => {
    const types = createProjectTypeService(db)
    const named = [{ name: 'alpha', path: dirA }, { name: 'bravo', path: dirB }]
    const pt = types.create({ name: 'type-a', workingDirectories: named as any })
    expect(pt.workingDirectories).toEqual(named)
    const project = projects.create({ name: 'alpha', typeId: pt.id, workingDirectories: named as any })
    expect(project.workingDirectories).toEqual(named)
  })

  it('copies the type list onto a project that omits its own directories', () => {
    const types = createProjectTypeService(db)
    const named = [{ name: 'alpha', path: dirA }]
    const pt = types.create({ name: 'type-a', workingDirectories: named as any })
    const project = projects.create({ name: 'alpha', typeId: pt.id })
    expect(project.workingDirectories).toEqual(named)
  })
})

describe('conversation adopts type working directories when the project list is empty', () => {
  let dirA: string
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let userId: string
  let projectId: string
  let named: { name: string; path: string }[]

  beforeEach(async () => {
    dirA = mkdtempSync(join(tmpdir(), 'eyas-inh-type-'))
    named = [{ name: 'alpha', path: dirA }]
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}`)
    const types = createProjectTypeService(db)
    const projects = createProjectService(db, types)
    const pt = types.create({ name: 'type-a', workingDirectories: named as any })
    const project = projects.create({ name: 'alpha', typeId: pt.id })
    projects.update(project.id, { workingDirectories: null })
    projectId = project.id

    const chatService = createConversationService(db)
    const ability = (() => {
      const reg = createPermissionRegistry()
      reg.registerSubject('Conversation', {
        actions: ['read', 'update', 'create', 'delete'],
        defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
      })
      return buildAbilityForRole('owner', reg)
    })()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    const getBoard = () => ({
      projects: {
        get: (id: string) => projects.get(id),
        getWithStages: (id: string) => projects.getWithStages(id),
      },
      projectTypes: {
        get: (id: string) => types.get(id),
      },
    })
    createConversationRoutes(
      app as any,
      chatService,
      createModelGateway(),
      createProviderConfigService(db),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getBoard as any,
    )
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dirA, { recursive: true, force: true })
  })

  it('pins the type list on create when the project has no directories of its own', async () => {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'pin-test', projectId }),
    })
    expect(res.status).toBe(201)
    const conv = await res.json() as any
    expect(conv.workingDirectories).toEqual(named)
  })

  it('replaces the conversation list with the type list when the project is assigned later', async () => {
    const created = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'later-pin', projectId: null }),
    })
    const conv = await created.json() as any
    const res = await app.request(`/api/v1/conversations/${conv.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as any
    expect(updated.workingDirectories).toEqual(named)
  })
})
