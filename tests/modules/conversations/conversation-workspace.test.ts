// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every conversation works in a folder: with no Folders from the request or
// the project it gets its own EYAS workspace under the workspaces root — on
// create whatever the project, and lazily on send for rows that have none.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

const testDb = createTestDb('conversation-workspace')

describe('conversation workspace assignment', () => {
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let chatService: ReturnType<typeof createConversationService>
  let projects: ReturnType<typeof createProjectService>
  let userFolder: string
  let root: string

  function mount(withBoard: boolean): void {
    const reg = createPermissionRegistry()
    for (const subject of ['Conversation', 'ConversationMessage']) {
      reg.registerSubject(subject, {
        actions: ['read', 'update', 'create', 'delete'],
        defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
      })
    }
    const ability = buildAbilityForRole('owner', reg)
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    const types = createProjectTypeService(db)
    const getBoard = withBoard
      ? () => ({
          projects: { get: (id: string) => projects.get(id), getWithStages: (id: string) => projects.getWithStages(id) },
          projectTypes: { get: (id: string) => types.get(id) },
        })
      : undefined
    createConversationRoutes(
      app as any, chatService, createModelGateway(), createProviderConfigService(db),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      getBoard as any,
    )
  }

  let userId: string

  beforeEach(async () => {
    root = process.env.EYAS_WORKSPACES_DIR!
    userFolder = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-convws-user-')))
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}`)
    chatService = createConversationService(db)
    projects = createProjectService(db, createProjectTypeService(db))
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(userFolder, { recursive: true, force: true })
  })

  async function create(body: Record<string, unknown>): Promise<any> {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(201)
    return res.json()
  }

  it('gives a conversation without a project its own workspace', async () => {
    mount(false)
    const conv = await create({ title: 'plain' })
    expect(conv.workingDirectories).toEqual([join(root, conv.id)])
    expect(existsSync(join(root, conv.id))).toBe(true)
  })

  it('gives a conversation whose project names no folders its own workspace', async () => {
    mount(true)
    const project = projects.create({ name: 'no folders' })
    projects.update(project.id, { workingDirectories: null })
    const conv = await create({ title: 'p', projectId: project.id })
    expect(conv.workingDirectories).toEqual([join(root, conv.id)])
  })

  it('treats an explicitly empty folder list as no folders', async () => {
    mount(false)
    const conv = await create({ title: 'empty', workingDirectories: [] })
    expect(conv.workingDirectories).toEqual([join(root, conv.id)])
  })

  it('keeps a folder the request names — no workspace is added', async () => {
    mount(false)
    const conv = await create({ title: 'mine', workingDirectories: [userFolder] })
    expect(conv.workingDirectories).toEqual([userFolder])
    expect(existsSync(join(root, conv.id))).toBe(false)
  })

  it("keeps the project's folders — no workspace is added", async () => {
    mount(true)
    const project = projects.create({ name: 'with folders', workingDirectories: [userFolder] })
    const conv = await create({ title: 'p', projectId: project.id })
    expect(conv.workingDirectories).toEqual([userFolder])
    expect(existsSync(join(root, conv.id))).toBe(false)
  })

  it('still creates the conversation when the workspaces root cannot be written', async () => {
    mount(false)
    const blocker = join(userFolder, 'not-a-dir')
    writeFileSync(blocker, 'x')
    const prev = process.env.EYAS_WORKSPACES_DIR
    process.env.EYAS_WORKSPACES_DIR = join(blocker, 'workspaces')
    try {
      const conv = await create({ title: 'unwritable' })
      expect(conv.workingDirectories).toBeNull()
    } finally {
      process.env.EYAS_WORKSPACES_DIR = prev
    }
  })

  it('assigns the workspace on send to a conversation that has no folders', async () => {
    mount(false)
    const legacy = chatService.create({ userId, title: 'legacy' })
    expect(chatService.get(legacy.id)?.workingDirectories).toBeNull()
    await app.request(`/api/v1/conversations/${legacy.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })
    expect(chatService.get(legacy.id)?.workingDirectories).toEqual([join(root, legacy.id)])
  })

  it('leaves the folders of a conversation that has some untouched on send', async () => {
    mount(false)
    const conv = chatService.create({ userId, title: 'has folders' })
    chatService.update(conv.id, { workingDirectories: [userFolder] })
    await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })
    expect(chatService.get(conv.id)?.workingDirectories).toEqual([userFolder])
    expect(existsSync(join(root, conv.id))).toBe(false)
  })

  it('does not assign a workspace for an invalid send', async () => {
    mount(false)
    const conv = chatService.create({ userId, title: 'invalid' })
    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(chatService.get(conv.id)?.workingDirectories).toBeNull()
  })
})
