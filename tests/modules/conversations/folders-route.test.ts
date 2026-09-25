// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B12: a conversation's Folders are validated by the one folder validator
// (tools/working-directories.ts) on create and on PATCH. A refused folder is
// a 400 carrying {error, code, path} — the web maps the code to
// projects.folders.error.<code> — and a refused create leaves no row behind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { createConversationService } from '@modules/conversations/conversation-service.js'
import { createConversationRoutes } from '@modules/conversations/routes.js'
import { createModelGateway } from '@modules/model/gateway.js'
import { createProviderConfigService } from '@modules/model/provider-config-service.js'
import { errorHandler } from '@core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import { createPermissionRegistry } from '@modules/permissions/registry.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'

const testDb = createTestDb('conversation-folders-route')

describe('conversation Folders — validation on save (B12)', () => {
  let f: SovereigntyFixture
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let userId: string
  let chatService: ReturnType<typeof createConversationService>
  let project: string

  const post = (body: unknown) => app.request('/api/v1/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const patch = (id: string, body: unknown) => app.request(`/api/v1/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  beforeEach(async () => {
    f = createSovereigntyFixture()
    installPathPolicy(f.policy)
    vi.stubEnv('HOME', f.home)
    project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })

    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}`)
    chatService = createConversationService(db)
    const reg = createPermissionRegistry()
    reg.registerSubject('Conversation', {
      actions: ['read', 'update', 'create', 'delete'],
      defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
    })
    const ability = buildAbilityForRole('owner', reg)
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    createConversationRoutes(app as any, chatService, createModelGateway(), createProviderConfigService(db))
  })

  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    testDb.cleanup()
    f.cleanup()
  })

  it('create: a folder inside a vault is a 400 with code vault and the path, and no conversation is created', async () => {
    const before = chatService.list(userId).length
    const res = await post({ title: 'refused', workingDirectories: [f.vault] })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body).toMatchObject({ code: 'vault', path: f.vault })
    expect(String(body.error)).toContain(f.vault)
    expect(chatService.list(userId).length).toBe(before)
  })

  it("create: the home folder, another tool's store and EYAS's data are refused with their codes", async () => {
    for (const [path, code] of [
      [f.home, 'home'],
      [join(f.home, '.claude', 'projects'), 'providerHome'],
      [join(f.dataDir, 'vault'), 'eyasData'],
    ] as const) {
      const res = await post({ title: code, workingDirectories: [path] })
      expect(res.status, code).toBe(400)
      expect(((await res.json()) as any).code, code).toBe(code)
    }
  })

  it('create: a valid folder is stored realpathed (201)', async () => {
    const res = await post({ title: 'ok', workingDirectories: [project] })
    expect(res.status).toBe(201)
    const conv = await res.json() as any
    expect(conv.workingDirectories).toEqual([realpathSync(project)])
  })

  it('patch: a refused folder is a 400 with the code, and the stored Folders stay', async () => {
    const created = await (await post({ title: 'p', workingDirectories: [project] })).json() as any
    const res = await patch(created.id, { workingDirectories: [join(f.dataDir, 'vault')] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'eyasData', path: join(f.dataDir, 'vault') })
    expect(chatService.get(created.id)?.workingDirectories).toEqual([realpathSync(project)])
  })

  it('patch: valid folders are saved (200); null clears', async () => {
    const created = await (await post({ title: 'p2' })).json() as any
    const ok = await patch(created.id, { workingDirectories: [{ name: 'frontend', path: project }] })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as any).workingDirectories).toEqual([{ name: 'frontend', path: realpathSync(project) }])
    const cleared = await patch(created.id, { workingDirectories: null })
    expect(cleared.status).toBe(200)
    expect(chatService.get(created.id)?.workingDirectories ?? null).toBeNull()
  })

  it('patch: a malformed list is refused before any folder is looked at (400, no code)', async () => {
    const created = await (await post({ title: 'p3' })).json() as any
    const res = await patch(created.id, { workingDirectories: project })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).code).toBeUndefined()
  })
})
