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

const testDb = createTestDb('board-tag-routes')
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

  app.use('/api/v1/tag-categories/*', authMiddleware)
  app.use('/api/v1/tags/*', authMiddleware)
  app.use('/api/v1/conversations/*', authMiddleware)
  app.use('/api/v1/projects/*', authMiddleware)
  app.use('/api/v1/project-types/*', authMiddleware)

  createBoardRoutes(
    app,
    { projectTypes: projectTypeService, projects: projectService, stages: stageService, tags: tagService },
    conversationService,
  )

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

// ─── Tag Categories CRUD ─────────────────────────────────────────────────────

describe('POST /api/v1/tag-categories', () => {
  it('creates a tag category and returns 201', async () => {
    const res = await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Priority', color: '#ff0000' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.tagCategory.id).toBeDefined()
    expect(body.tagCategory.name).toBe('Priority')
    expect(body.tagCategory.color).toBe('#ff0000')
  })

  it('returns 400 without name', async () => {
    const res = await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/tag-categories', () => {
  it('lists all tag categories', async () => {
    await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Category A' }),
    })
    await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Category B' }),
    })

    const res = await app.request('/api/v1/tag-categories', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.tagCategories).toHaveLength(2)
  })
})

describe('PATCH /api/v1/tag-categories/:id', () => {
  it('updates a tag category', async () => {
    const createRes = await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Original' }),
    })
    const { tagCategory } = await createRes.json() as any

    const res = await app.request(`/api/v1/tag-categories/${tagCategory.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Updated' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/v1/tag-categories/:id', () => {
  it('deletes a tag category', async () => {
    const createRes = await app.request('/api/v1/tag-categories', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'To Delete' }),
    })
    const { tagCategory } = await createRes.json() as any

    const delRes = await app.request(`/api/v1/tag-categories/${tagCategory.id}`, {
      method: 'DELETE',
      headers: auth(),
    })
    expect(delRes.status).toBe(200)

    const listRes = await app.request('/api/v1/tag-categories', { headers: auth() })
    const body = await listRes.json() as any
    expect(body.tagCategories).toHaveLength(0)
  })
})

// ─── Tags CRUD ───────────────────────────────────────────────────────────────

describe('POST /api/v1/tags', () => {
  it('creates a tag and returns 201', async () => {
    const res = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Urgent', color: '#e11d48' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.tag.id).toBeDefined()
    expect(body.tag.name).toBe('Urgent')
    expect(body.tag.color).toBe('#e11d48')
  })

  it('returns 400 without name', async () => {
    const res = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/tags', () => {
  it('lists all tags', async () => {
    await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Bug' }),
    })
    await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Feature' }),
    })

    const res = await app.request('/api/v1/tags', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.tags).toHaveLength(2)
  })
})

describe('PATCH /api/v1/tags/:id', () => {
  it('updates a tag', async () => {
    const createRes = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Old Name' }),
    })
    const { tag } = await createRes.json() as any

    const res = await app.request(`/api/v1/tags/${tag.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'New Name', color: '#00ff00' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/v1/tags/:id', () => {
  it('deletes a tag', async () => {
    const createRes = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Deletable' }),
    })
    const { tag } = await createRes.json() as any

    const delRes = await app.request(`/api/v1/tags/${tag.id}`, {
      method: 'DELETE',
      headers: auth(),
    })
    expect(delRes.status).toBe(200)

    const listRes = await app.request('/api/v1/tags', { headers: auth() })
    const body = await listRes.json() as any
    expect(body.tags).toHaveLength(0)
  })
})

// ─── Conversation Tags ───────────────────────────────────────────────────────

describe('PUT /api/v1/conversations/:id/tags', () => {
  it('sets tags on a conversation and returns them', async () => {
    // Create a project + conversation first
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Dev', defaultStages: ['Backlog', 'Done'] }),
    })
    const { projectType } = await typeRes.json() as any

    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Tag Test Project', typeId: projectType.id }),
    })
    const { project } = await projRes.json() as any

    const convRes = await app.request(`/api/v1/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ title: 'Tagged conv' }),
    })
    const { conversation } = await convRes.json() as any

    // Create two tags
    const tag1Res = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Bug' }),
    })
    const { tag: tag1 } = await tag1Res.json() as any

    const tag2Res = await app.request('/api/v1/tags', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Critical' }),
    })
    const { tag: tag2 } = await tag2Res.json() as any

    // Set tags on conversation
    const setRes = await app.request(`/api/v1/conversations/${conversation.id}/tags`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ tagIds: [tag1.id, tag2.id] }),
    })
    expect(setRes.status).toBe(200)
    const body = await setRes.json() as any
    expect(body.tags).toHaveLength(2)
    const tagNames = body.tags.map((t: any) => t.name).sort()
    expect(tagNames).toEqual(['Bug', 'Critical'])
  })

  it('returns 404 for non-existent conversation', async () => {
    const res = await app.request('/api/v1/conversations/nonexistent/tags', {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ tagIds: [] }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 without tagIds array', async () => {
    // Create a conversation to have a valid id
    const typeRes = await app.request('/api/v1/project-types', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Simple', defaultStages: ['Todo'] }),
    })
    const { projectType } = await typeRes.json() as any

    const projRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Validation Project', typeId: projectType.id }),
    })
    const { project } = await projRes.json() as any

    const convRes = await app.request(`/api/v1/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ title: 'Bad body conv' }),
    })
    const { conversation } = await convRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conversation.id}/tags`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ wrong: 'field' }),
    })
    expect(res.status).toBe(400)
  })
})
