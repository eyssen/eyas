// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Regression: another user's conversation workspace through a stored folder.
// The chain: u2 lists the workspaces root, PATCHes its own conversation's
// Folders to u1's workspace, then opens an OpenCode terminal for its own
// conversation — which then worked in u1's workspace. A conversation
// workspace is now a folder only of that conversation and of its owner's
// other conversations: refused on every save (conversation POST/PATCH, a
// board card), and left out at run time for a folder stored before the rule
// or reached through a symlink.

import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler.js'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service.js'
import { createConversationRoutes } from '@modules/conversations/routes.js'
import { createModelGateway } from '@modules/model/gateway.js'
import { createProviderConfigService } from '@modules/model/provider-config-service.js'
import { createBoardRoutes } from '@modules/board/routes.js'
import { createProjectTypeService } from '@modules/board/services/project-type-service.js'
import { createProjectService } from '@modules/board/services/project-service.js'
import { createStageService } from '@modules/board/services/stage-service.js'
import { createTagService } from '@modules/board/services/tag-service.js'
import { createOpencodeRoutes } from '@modules/opencode/routes.js'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store.js'
import type { PtyManager } from '@modules/opencode/pty-manager.js'
import type { OpencodeRunner } from '@modules/opencode/opencode-runner.js'
import type { PtySessionRecord } from '@modules/opencode/types.js'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import { createPermissionRegistry } from '@modules/permissions/registry.js'
import type { RoleId } from '@modules/permissions/types.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'

const testDb = createTestDb('workspace-ownership-chain')

describe('another user\'s conversation workspace cannot become a folder (save → terminal chain)', () => {
  let f: SovereigntyFixture
  let db: ReturnType<typeof testDb.open>
  let chat: ConversationService
  let app: Hono
  let u1: string
  let u2: string
  let caller: { id: string; role: RoleId }
  let projectId: string
  const created: Array<{ userId: string; conversationId: string; kind: string; cwd?: string; workingDirectories?: string[] }> = []

  const as = (id: string, role: RoleId = 'user') => { caller = { id, role } }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: await res.json() as any }
  }
  const workspaceOf = (id: string) => join(f.workspacesRoot, id)

  beforeEach(async () => {
    created.length = 0
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
    db = testDb.open()
    u1 = await insertTestOwner(db, `u1-${Date.now()}`)
    u2 = await insertTestOwner(db, `u2-${Date.now()}`)
    chat = createConversationService(db)

    const reg = createPermissionRegistry()
    reg.registerSubject('Conversation', {
      actions: ['read', 'update', 'create', 'delete'],
      defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
    })
    reg.registerSubject('OpenCode', {
      actions: ['read', 'create', 'manage'],
      defaults: { owner: ['manage'], admin: ['manage'], user: ['read', 'create'], agent: ['create'], guest: [] },
    })
    as(u1)
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('userId', caller.id)
      c.set('role', caller.role)
      c.set('ability', buildAbilityForRole(caller.role, reg))
      await next()
    })
    createConversationRoutes(app as any, chat, createModelGateway(), createProviderConfigService(db))
    const projectTypes = createProjectTypeService(db)
    const projects = createProjectService(db, projectTypes)
    projectId = projects.create({ name: 'Shared board' }).id
    createBoardRoutes(app, {
      projectTypes,
      projects,
      stages: createStageService(db),
      tags: createTagService(db),
    }, chat)
    const settings = normalizeOpencodeSettings({})
    createOpencodeRoutes(app, {
      runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
      load: () => settings,
      save: () => undefined,
      pty: {
        create: (input: { userId: string; conversationId: string; kind: 'tui' | 'shell'; cwd?: string; workingDirectories?: string[] }) => {
          created.push(input)
          return { id: 'pty1', userId: input.userId, conversationId: input.conversationId, kind: input.kind, cwd: input.cwd ?? '', cols: 80, rows: 24, pid: 1, state: 'running', createdAt: 0, lastActivityAt: 0 } satisfies PtySessionRecord
        },
      } as unknown as PtyManager,
      opencode: { ensureServer: async () => ({}) } as unknown as OpencodeRunner,
      getTools: () => undefined,
      pluginTokens: { redeem: () => null },
      sessions: { lookup: () => null },
      getConversations: () => chat,
      resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
      resolveShellCommand: () => ({ file: '/bin/sh', args: ['-l'], env: {} }),
    })
  })

  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    testDb.cleanup()
    f.cleanup()
  })

  /** u1's conversation (its own workspace on disk, with a sub-folder) and u2's. */
  async function twoUsers() {
    as(u1)
    const a = (await call('POST', '/api/v1/conversations', { title: 'u1 secret work' })).body
    const aWs = workspaceOf(a.id)
    mkdirSync(join(aWs, 'src'), { recursive: true })
    as(u2)
    const b = (await call('POST', '/api/v1/conversations', { title: 'u2 conversation' })).body
    return { a, aWs, b }
  }

  it('(−) the reported chain: PATCH to u1\'s workspace is a 400 (otherWorkspace), and u2\'s terminal still opens only in u2\'s own workspace', async () => {
    const { aWs, b } = await twoUsers()
    // Step 1: the workspaces root lists u1's id (the browse route); saving it is refused.
    const patched = await call('PATCH', `/api/v1/conversations/${b.id}`, { workingDirectories: [aWs] })
    expect(patched.status).toBe(400)
    expect(patched.body).toMatchObject({ code: 'otherWorkspace', path: aWs })
    expect(chat.get(b.id)?.workingDirectories).toEqual([workspaceOf(b.id)])
    // Step 2: the terminal of u2's own conversation works in u2's workspace only.
    for (const kind of ['tui'] as const) {
      const opened = await call('POST', '/api/v1/opencode/sessions', { conversationId: b.id, kind })
      expect(opened.status).toBe(200)
    }
    expect(created.map((c) => c.cwd)).toEqual([workspaceOf(b.id)])
    expect(created[0]?.workingDirectories).toEqual([workspaceOf(b.id)])
    // A cwd naming u1's workspace is outside the conversation's folders.
    expect((await call('POST', '/api/v1/opencode/sessions', { conversationId: b.id, kind: 'tui', cwd: aWs })).status).toBe(400)
    // A plain shell is not a `user`'s at all.
    expect((await call('POST', '/api/v1/opencode/sessions', { conversationId: b.id, kind: 'shell' })).status).toBe(403)
    expect(created).toHaveLength(1)
  })

  it('(−) a sub-folder of, or a symlink into, u1\'s workspace is refused on PATCH, on create and on a board card; nothing is created', async () => {
    const { aWs, b } = await twoUsers()
    mkdirSync(join(f.root, 'links'), { recursive: true })
    const link = join(f.root, 'links', 'u1')
    symlinkSync(aWs, link)
    for (const folder of [join(aWs, 'src'), link]) {
      const patched = await call('PATCH', `/api/v1/conversations/${b.id}`, { workingDirectories: [folder] })
      expect(patched.status, folder).toBe(400)
      expect(patched.body.code, folder).toBe('otherWorkspace')
    }
    const before = chat.list(u2).length
    const posted = await call('POST', '/api/v1/conversations', { title: 'x', workingDirectories: [aWs] })
    expect(posted.status).toBe(400)
    expect(posted.body.code).toBe('otherWorkspace')
    const card = await call('POST', `/api/v1/projects/${projectId}/conversations`, { title: 'card', workingDirectories: [join(aWs, 'src')] })
    expect(card.status).toBe(400)
    expect(card.body.code).toBe('otherWorkspace')
    expect(chat.list(u2).length).toBe(before)
    // A run's scratch folder is no conversation's.
    const scratch = join(f.workspacesRoot, '_runs', 'run-1')
    mkdirSync(scratch, { recursive: true })
    expect((await call('PATCH', `/api/v1/conversations/${b.id}`, { workingDirectories: [scratch] })).body.code).toBe('otherWorkspace')
  })

  it('(−) a folder stored before the rule is left out at run time: the terminal opens in u2\'s workspace and says why', async () => {
    const { aWs, b } = await twoUsers()
    chat.update(b.id, { workingDirectories: [aWs] })
    const opened = await call('POST', '/api/v1/opencode/sessions', { conversationId: b.id, kind: 'tui' })
    expect(opened.status).toBe(200)
    expect(created[0]?.cwd).toBe(workspaceOf(b.id))
    expect(opened.body.notices).toEqual([{ code: 'folderRefused', params: { path: aWs, reason: 'otherWorkspace' } }])
  })

  it('(+) the owner may use the workspace of their own other conversation; the owner\'s shell opens too', async () => {
    const { a, aWs } = await twoUsers()
    as(u1)
    const a2 = (await call('POST', '/api/v1/conversations', { title: 'u1 follow-up', workingDirectories: [aWs] }))
    expect(a2.status).toBe(201)
    expect(a2.body.workingDirectories).toEqual([realpathSync(aWs)])
    mkdirSync(workspaceOf(a2.body.id), { recursive: true })
    const patched = await call('PATCH', `/api/v1/conversations/${a2.body.id}`, { workingDirectories: [join(aWs, 'src'), workspaceOf(a2.body.id)] })
    expect(patched.status).toBe(200)
    expect((await call('POST', '/api/v1/opencode/sessions', { conversationId: a2.body.id, kind: 'tui' })).status).toBe(200)
    expect(created[0]?.cwd).toBe(realpathSync(join(aWs, 'src')))
    // Its own workspace is always its own.
    expect((await call('PATCH', `/api/v1/conversations/${a.id}`, { workingDirectories: [aWs] })).status).toBe(200)
    as(u1, 'owner')
    expect((await call('POST', '/api/v1/opencode/sessions', { conversationId: a.id, kind: 'shell' })).status).toBe(200)
    expect(created.map((c) => c.kind)).toEqual(['tui', 'shell'])
    expect(existsSync(aWs)).toBe(true)
  })
})
