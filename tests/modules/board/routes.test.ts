import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createBoardRoutes } from '@modules/board/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createTagService } from '@modules/board/services/tag-service'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import { tmpdir } from 'node:os'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const testDb = createTestDb('board-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

const auth = () => ({ Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' })

beforeEach(async () => {
  db = testDb.open()

  const conversationService = createConversationService(db)
  const projectTypeService = createProjectTypeService(db)
  const projectService = createProjectService(db, projectTypeService)
  const stageService = createStageService(db)
  const tagService = createTagService(db)

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  const authMiddleware = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
      const s = rows[0]
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async () => null,
    findUserById: async (id) => {
      const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
      const u = rows[0]
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
  })

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

  app.use('/api/v1/project-types/*', authMiddleware)
  app.use('/api/v1/projects/*', authMiddleware)
  app.use('/api/v1/stages/*', authMiddleware)
  app.use('/api/v1/conversations/*', authMiddleware)

  createBoardRoutes(app, { projectTypes: projectTypeService, projects: projectService, stages: stageService, tags: tagService }, conversationService)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

// ─── Project Types CRUD ───────────────────────────────────────────────────────

describe('POST /api/v1/project-types', () => {
  it('creates a project type and returns 201', async () => {
    const res = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Software', defaultStages: ['Todo', 'In Progress', 'Done'] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.projectType.id).toBeDefined()
    expect(body.projectType.name).toBe('Software')
    expect(body.projectType.defaultStages).toEqual(['Todo', 'In Progress', 'Done'])
  })

  it('returns 400 without name', async () => {
    const res = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('requires auth', async () => {
    const res = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No auth' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/project-types', () => {
  it('lists all project types', async () => {
    await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Type A' }),
    })
    await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Type B' }),
    })

    const res = await app.request('/api/v1/project-types', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.projectTypes).toHaveLength(2)
  })
})

describe('PATCH /api/v1/project-types/:id', () => {
  it('updates a project type', async () => {
    const createRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Original Name' }),
    })
    const { projectType } = await createRes.json() as any

    const res = await app.request(`/api/v1/project-types/${projectType.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Updated Name' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.projectType.name).toBe('Updated Name')
  })

  it('returns 404 for non-existent project type', async () => {
    const res = await app.request('/api/v1/project-types/nonexistent', {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(404)
  })

  it('stores named working directories on a project type', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-type-wd-'))
    try {
      const createRes = await app.request('/api/v1/project-types', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ name: 'type-a' }),
      })
      const { projectType } = await createRes.json() as any
      const res = await app.request(`/api/v1/project-types/${projectType.id}`, {
        method: 'PATCH',
        headers: auth(),
        body: JSON.stringify({ workingDirectories: [{ name: 'alpha', path: dir }] }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.projectType.workingDirectories).toEqual([{ name: 'alpha', path: realpathSync(dir) }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lets an owner configure a seed type prompt without renaming it', async () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, source, created_at)
      VALUES ('odoo', 'Odoo', 'seed brief', '["Backlog"]', 'normal', 'seed', ${now})`)

    const rename = await app.request('/api/v1/project-types/odoo', {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Renamed' }),
    })
    expect(rename.status).toBe(400)

    const res = await app.request('/api/v1/project-types/odoo', {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ prompt: 'Instance domain brief', indexedSources: ['src-a'] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.projectType.name).toBe('Odoo')
    expect(body.projectType.prompt).toBe('Instance domain brief')
    expect(body.projectType.indexedSources).toEqual(['src-a'])
  })
})

describe('DELETE /api/v1/project-types/:id', () => {
  it('deletes a project type', async () => {
    const createRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'To Delete' }),
    })
    const { projectType } = await createRes.json() as any

    const delRes = await app.request(`/api/v1/project-types/${projectType.id}`, {
      method: 'DELETE',
      headers: auth(),
    })
    expect(delRes.status).toBe(200)

    const listRes = await app.request('/api/v1/project-types', { headers: auth() })
    const body = await listRes.json() as any
    expect(body.projectTypes.every((t: any) => t.id !== projectType.id)).toBe(true)
  })

  it('returns 404 for non-existent project type', async () => {
    const res = await app.request('/api/v1/project-types/nonexistent', {
      method: 'DELETE',
      headers: auth(),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Projects with auto-stages ────────────────────────────────────────────────

describe('POST /api/v1/projects with typeId', () => {
  it('creates project and auto-generates stages from type', async () => {
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Kanban', defaultStages: ['Backlog', 'In Progress', 'Done'] }),
    })
    const { projectType } = await typeRes.json() as any

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'My Project', typeId: projectType.id, workingDirectories: [tmpdir()] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.project.id).toBeDefined()
    expect(body.project.name).toBe('My Project')
    expect(body.project.typeId).toBe(projectType.id)
  })

  it('creates two projects under the same type (fictive names)', async () => {
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'type-a', defaultStages: ['Backlog', 'Done'] }),
    })
    const { projectType } = await typeRes.json() as any
    const alpha = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'alpha', typeId: projectType.id, workingDirectories: [tmpdir()] }),
    })
    const bravo = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'bravo', typeId: projectType.id, workingDirectories: [tmpdir()] }),
    })
    expect(alpha.status).toBe(201)
    expect(bravo.status).toBe(201)
    const a = await alpha.json() as any
    const b = await bravo.json() as any
    expect(a.project.typeId).toBe(projectType.id)
    expect(b.project.typeId).toBe(projectType.id)
    expect(a.project.id).not.toBe(b.project.id)
  })

  it('stores default and ticket connection ids on create and patch', async () => {
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'type-a', defaultStages: ['Backlog', 'Done'] }),
    })
    const { projectType } = await typeRes.json() as any
    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        name: 'alpha',
        typeId: projectType.id,
        workingDirectories: [tmpdir()],
        defaultConnectionId: 'conn-alpha-db',
        ticketConnectionId: 'conn-alpha-tickets',
      }),
    })
    expect(created.status).toBe(201)
    const { project } = await created.json() as any
    expect(project.defaultConnectionId).toBe('conn-alpha-db')
    expect(project.ticketConnectionId).toBe('conn-alpha-tickets')

    const patched = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ defaultConnectionId: 'conn-bravo-db' }),
    })
    expect(patched.status).toBe(200)
    const updated = await patched.json() as any
    expect(updated.project.defaultConnectionId).toBe('conn-bravo-db')
    expect(updated.project.ticketConnectionId).toBe('conn-alpha-tickets')
  })

  it('returns 400 without name', async () => {
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/projects/:id', () => {
  it('returns project with stages', async () => {
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Scrum', defaultStages: ['Todo', 'Doing', 'Done'] }),
    })
    const { projectType } = await typeRes.json() as any

    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Sprint 1', typeId: projectType.id, workingDirectories: [tmpdir()] }),
    })
    const { project } = await projRes.json() as any

    const res = await app.request(`/api/v1/projects/${project.id}`, { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.project.id).toBe(project.id)
    expect(Array.isArray(body.project.stages)).toBe(true)
    expect(body.project.stages).toHaveLength(3)
    expect(body.project.stages.map((s: any) => s.name)).toEqual(['Todo', 'Doing', 'Done'])
  })

  it('returns 404 for non-existent project', async () => {
    const res = await app.request('/api/v1/projects/nonexistent', { headers: auth() })
    expect(res.status).toBe(404)
  })
})

// ─── Board View ───────────────────────────────────────────────────────────────

describe('GET /api/v1/projects/:id/board', () => {
  it('returns project with global stages and conversations', async () => {
    // Create global stages first (board always uses global stages)
    await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Backlog', color: '#aaa', sortOrder: 0 }),
    })
    const stageRes = await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'In Progress', color: '#ff0', sortOrder: 1 }),
    })
    await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Done', color: '#0f0', sortOrder: 2 }),
    })

    // Get global stage IDs
    const stagesListRes = await app.request('/api/v1/stages', { headers: auth() })
    const { stages: globalStages } = await stagesListRes.json() as any
    const backlogStage = globalStages.find((s: any) => s.name === 'Backlog')

    // Create project (no type needed — board uses global stages)
    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Dev Project', workingDirectories: [tmpdir()] }),
    })
    const { project } = await projRes.json() as any

    // Add conversation to the project in backlog stage
    const convRes = await app.request(`/api/v1/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ title: 'Feature: login', stageId: backlogStage.id }),
    })
    expect(convRes.status).toBe(201)
    const { conversation } = await convRes.json() as any
    expect(conversation.projectId).toBe(project.id)

    // Check board view — should use global stages
    const boardRes = await app.request(`/api/v1/projects/${project.id}/board`, { headers: auth() })
    expect(boardRes.status).toBe(200)
    const body = await boardRes.json() as any
    expect(body.project.id).toBe(project.id)
    expect(Array.isArray(body.stages)).toBe(true)
    expect(body.stages).toHaveLength(3)

    // Conversation should appear in Backlog stage
    const boardBacklog = body.stages.find((s: any) => s.name === 'Backlog')
    expect(boardBacklog).toBeDefined()
    expect(boardBacklog.conversations).toHaveLength(1)
    expect(boardBacklog.conversations[0].id).toBe(conversation.id)
  })

  it('returns 404 for non-existent project', async () => {
    const res = await app.request('/api/v1/projects/nonexistent/board', { headers: auth() })
    expect(res.status).toBe(404)
  })
})

// ─── Conversation Move ────────────────────────────────────────────────────────

describe('PATCH /api/v1/conversations/:id/move', () => {
  it('moves conversation to a different stage', async () => {
    // Create global stages
    await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Stage A', sortOrder: 0 }),
    })
    await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Stage B', sortOrder: 1 }),
    })

    const stagesRes = await app.request('/api/v1/stages', { headers: auth() })
    const { stages } = await stagesRes.json() as any
    const stageA = stages.find((s: any) => s.name === 'Stage A')
    const stageB = stages.find((s: any) => s.name === 'Stage B')

    // Create project
    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Move Test Project', workingDirectories: [tmpdir()] }),
    })
    const { project } = await projRes.json() as any

    // Create conversation in Stage A
    const convRes = await app.request(`/api/v1/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ title: 'Task to move', stageId: stageA.id }),
    })
    const { conversation } = await convRes.json() as any
    expect(conversation.stageId).toBe(stageA.id)

    // Move to Stage B
    const moveRes = await app.request(`/api/v1/conversations/${conversation.id}/move`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ stageId: stageB.id }),
    })
    expect(moveRes.status).toBe(200)
    const moveBody = await moveRes.json() as any
    expect(moveBody.conversation.stageId).toBe(stageB.id)

    // Verify on board: conversation is now in Stage B
    const boardRes = await app.request(`/api/v1/projects/${project.id}/board`, { headers: auth() })
    const boardBody = await boardRes.json() as any
    const sA = boardBody.stages.find((s: any) => s.id === stageA.id)
    const sB = boardBody.stages.find((s: any) => s.id === stageB.id)
    expect(sA.conversations).toHaveLength(0)
    expect(sB.conversations).toHaveLength(1)
    expect(sB.conversations[0].id).toBe(conversation.id)
  })

  it('returns 404 for non-existent conversation', async () => {
    const res = await app.request('/api/v1/conversations/nonexistent/move', {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ stageId: 'some-stage' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Stage auto-assignee plumbing ─────────────────────────────────────────────

describe('stage autoAssigneeId over HTTP', () => {
  it('POST /api/v1/stages persists and echoes autoAssigneeId', async () => {
    const res = await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Bot Stage', botListen: true, autoAssigneeId: 'agent-7' }),
    })
    expect(res.status).toBe(201)
    const { stage } = await res.json() as any
    expect(stage.autoAssigneeId).toBe('agent-7')

    const listRes = await app.request('/api/v1/stages', { headers: auth() })
    const { stages } = await listRes.json() as any
    expect(stages.find((s: any) => s.id === stage.id).autoAssigneeId).toBe('agent-7')
  })

  it('POST /api/v1/projects/:id/stages persists autoAssigneeId', async () => {
    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Auto Project', workingDirectories: [tmpdir()] }),
    })
    const { project } = await projRes.json() as any

    const res = await app.request(`/api/v1/projects/${project.id}/stages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Project Bot Stage', autoAssigneeId: 'agent-9' }),
    })
    expect(res.status).toBe(201)
    const { stage } = await res.json() as any
    expect(stage.autoAssigneeId).toBe('agent-9')
  })

  it('PATCH /api/v1/stages/:id sets and clears autoAssigneeId', async () => {
    const createRes = await app.request('/api/v1/stages', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Editable' }),
    })
    const { stage } = await createRes.json() as any
    expect(stage.autoAssigneeId).toBeNull()

    const setRes = await app.request(`/api/v1/stages/${stage.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ autoAssigneeId: 'agent-7' }),
    })
    expect(((await setRes.json()) as any).stage.autoAssigneeId).toBe('agent-7')

    const clearRes = await app.request(`/api/v1/stages/${stage.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ autoAssigneeId: null }),
    })
    expect(((await clearRes.json()) as any).stage.autoAssigneeId).toBeNull()
  })
})
