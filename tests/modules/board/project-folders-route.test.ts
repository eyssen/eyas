// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B12: project and project-type working directories pass the one folder
// validator (tools/working-directories.ts) on create and on PATCH. A refused
// folder is a 400 carrying {error, code, path}; the stored list is untouched.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler.js'
import { createTestDb } from '../../helpers/test-db.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { createBoardRoutes } from '@modules/board/routes.js'
import { createConversationService } from '@modules/conversations/conversation-service.js'
import { createProjectTypeService } from '@modules/board/services/project-type-service.js'
import { createProjectService } from '@modules/board/services/project-service.js'
import { createStageService } from '@modules/board/services/stage-service.js'
import { createTagService } from '@modules/board/services/tag-service.js'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import { createPermissionRegistry } from '@modules/permissions/registry.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'

const testDb = createTestDb('project-folders-route')

describe('project / project-type folders — validation on save (B12)', () => {
  let f: SovereigntyFixture
  let app: Hono
  let projectService: ReturnType<typeof createProjectService>
  let typeService: ReturnType<typeof createProjectTypeService>
  let folder: string

  const send = (method: 'POST' | 'PATCH', path: string, body: unknown) => app.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  beforeEach(() => {
    f = createSovereigntyFixture()
    installPathPolicy(f.policy)
    vi.stubEnv('HOME', f.home)
    folder = join(f.root, 'projects', 'app')
    mkdirSync(folder, { recursive: true })

    const db = testDb.open()
    typeService = createProjectTypeService(db)
    projectService = createProjectService(db, typeService)
    const ability = buildAbilityForRole('owner', createPermissionRegistry())
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      await next()
    })
    createBoardRoutes(app, {
      projectTypes: typeService,
      projects: projectService,
      stages: createStageService(db),
      tags: createTagService(db),
    }, createConversationService(db))
  })

  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    testDb.cleanup()
    f.cleanup()
  })

  it('project create: a vault folder is a 400 with code and path; nothing is created', async () => {
    const before = projectService.list().length
    const res = await send('POST', '/projects', { name: 'refused', workingDirectories: [f.vault] })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body).toMatchObject({ code: 'vault', path: f.vault })
    expect(String(body.error)).toContain(f.vault)
    expect(projectService.list().length).toBe(before)
  })

  it('project create: a valid folder saves (201)', async () => {
    const res = await send('POST', '/projects', { name: 'ok', workingDirectories: [folder] })
    expect(res.status).toBe(201)
    expect(((await res.json()) as any).project.workingDirectories).toEqual([realpathSync(folder)])
  })

  it('project patch: home and an EYAS-owned CLI home are refused; the stored list stays', async () => {
    const created = await (await send('POST', '/projects', { name: 'p', workingDirectories: [folder] })).json() as any
    const id = created.project.id
    const cliHome = join(f.dataDir, 'cli-homes', 'grok-cli')
    mkdirSync(cliHome, { recursive: true })
    for (const [path, code] of [[f.home, 'home'], [cliHome, 'providerHome']] as const) {
      const res = await send('PATCH', `/projects/${id}`, { workingDirectories: [path] })
      expect(res.status, code).toBe(400)
      expect(((await res.json()) as any).code, code).toBe(code)
    }
    expect(projectService.get(id)?.workingDirectories).toEqual([realpathSync(folder)])
  })

  it('project patch: a valid list saves (200) and [] clears', async () => {
    const created = await (await send('POST', '/projects', { name: 'p2' })).json() as any
    const id = created.project.id
    const src = join(f.repo, 'src')
    const ok = await send('PATCH', `/projects/${id}`, { workingDirectories: [src] })
    expect(ok.status).toBe(200)
    expect(projectService.get(id)?.workingDirectories).toEqual([realpathSync(src)])
    const cleared = await send('PATCH', `/projects/${id}`, { workingDirectories: [] })
    expect(cleared.status).toBe(200)
    expect(projectService.get(id)?.workingDirectories ?? []).toEqual([])
  })

  it('project type create/patch: EYAS data and a foreign store are refused; a valid folder saves', async () => {
    const refused = await send('POST', '/project-types', { name: 'bad', workingDirectories: [join(f.dataDir, 'vault')] })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'eyasData', path: join(f.dataDir, 'vault') })

    const created = await send('POST', '/project-types', { name: 'good', workingDirectories: [folder] })
    expect(created.status).toBe(201)
    const id = ((await created.json()) as any).projectType.id
    const patched = await send('PATCH', `/project-types/${id}`, { workingDirectories: [join(f.home, '.grok')] })
    expect(patched.status).toBe(400)
    expect(((await patched.json()) as any).code).toBe('providerHome')
    expect(typeService.get(id)?.workingDirectories).toEqual([realpathSync(folder)])
  })

  // K2: a folder is judged by what it contains, too.
  it('project create/patch and project type create: a checkout holding the EYAS data dir or a folder holding a vault is a 400 naming what was found', async () => {
    const documents = join(f.home, 'Documents')
    const vault = join(documents, 'Notes')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })

    const repo = await send('POST', '/projects', { name: 'repo', workingDirectories: [f.repo] })
    expect(repo.status).toBe(400)
    expect(await repo.json()).toMatchObject({ code: 'containsEyasData', path: f.repo, found: f.dataDir })

    const created = await (await send('POST', '/projects', { name: 'p3', workingDirectories: [folder] })).json() as any
    const patched = await send('PATCH', `/projects/${created.project.id}`, { workingDirectories: [folder, documents] })
    expect(patched.status).toBe(400)
    expect(await patched.json()).toMatchObject({ code: 'containsVault', path: documents, found: vault })
    expect(projectService.get(created.project.id)?.workingDirectories).toEqual([realpathSync(folder)])

    const type = await send('POST', '/project-types', { name: 'docs', workingDirectories: [documents] })
    expect(type.status).toBe(400)
    expect(((await type.json()) as any).code).toBe('containsVault')
  })

  it('a malformed list is a 400 without a code', async () => {
    const res = await send('POST', '/projects', { name: 'x', workingDirectories: folder })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).code).toBeUndefined()
  })
})
