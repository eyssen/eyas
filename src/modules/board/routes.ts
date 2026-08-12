// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ProjectTypeService } from './services/project-type-service.js'
import type { ProjectService } from './services/project-service.js'
import type { StageService } from './services/stage-service.js'
import type { TagService } from './services/tag-service.js'
import type { ConversationService } from '@modules/conversations/conversation-service'
import { enrichBoardConversations } from './enrich-board-conversations.js'

interface BoardServices {
  projectTypes: ProjectTypeService
  projects: ProjectService
  stages: StageService
  tags: TagService
  /** Optional raw db for card enrichment (agent names, subtask counts). */
  db?: any
}

export function createBoardRoutes(app: Hono, board: BoardServices, conversationService: ConversationService): void {
  const enrich = (list: ReturnType<ConversationService['listByProject']>) =>
    board.db ? enrichBoardConversations(board.db, list) : list.map((c) => ({
      ...c,
      agentName: null as string | null,
      childCount: 0,
      childrenDone: 0,
    }))

  // ─── Project Types ────────────────────────────────────

  app.get('/api/v1/project-types', requirePermission('read', 'ProjectType'), (c) => {
    const types = board.projectTypes.list()
    return c.json({ projectTypes: types })
  })

  app.post('/api/v1/project-types', requirePermission('create', 'ProjectType'), async (c) => {
    const body = await c.req.json()
    if (!body.name) {
      throw new HTTPException(400, { message: 'Name is required' })
    }
    const pt = board.projectTypes.create(body)
    return c.json({ projectType: pt }, 201)
  })

  app.patch('/api/v1/project-types/:id', requirePermission('update', 'ProjectType'), async (c) => {
    const id = c.req.param('id')
    const existing = board.projectTypes.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Project type not found' })
    }
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot modify system resource' })
    }
    const body = await c.req.json()
    board.projectTypes.update(id, body)
    const updated = board.projectTypes.get(id)
    return c.json({ projectType: updated })
  })

  app.delete('/api/v1/project-types/:id', requirePermission('delete', 'ProjectType'), (c) => {
    const id = c.req.param('id')
    const existing = board.projectTypes.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Project type not found' })
    }
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot delete system resource' })
    }
    board.projectTypes.delete(id)
    return c.json({ message: 'Project type deleted' })
  })

  // ─── Projects ─────────────────────────────────────────

  app.get('/api/v1/projects', requirePermission('read', 'Project'), (c) => {
    const projects = board.projects.list()
    return c.json({ projects })
  })

  app.post('/api/v1/projects', requirePermission('create', 'Project'), async (c) => {
    const body = await c.req.json()
    if (!body.name) {
      throw new HTTPException(400, { message: 'Name is required' })
    }
    const project = board.projects.create(body)
    return c.json({ project }, 201)
  })

  app.get('/api/v1/projects/:id', requirePermission('read', 'Project'), (c) => {
    const id = c.req.param('id')
    const project = board.projects.getWithStages(id)
    if (!project) {
      throw new HTTPException(404, { message: 'Project not found' })
    }
    return c.json({ project })
  })

  app.patch('/api/v1/projects/:id', requirePermission('update', 'Project'), async (c) => {
    const id = c.req.param('id')
    const existing = board.projects.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Project not found' })
    }
    const body = await c.req.json()
    if ((existing as any).source === 'seed') {
      // Seed projects: only allow configuration changes (not rename/delete)
      const { defaultAgentId, prompt, color, description, indexedSources } = body
      const allowed: any = {}
      if (defaultAgentId !== undefined) allowed.defaultAgentId = defaultAgentId
      if (prompt !== undefined) allowed.prompt = prompt
      if (color !== undefined) allowed.color = color
      if (description !== undefined) allowed.description = description
      if (indexedSources !== undefined) allowed.indexedSources = indexedSources
      if (Object.keys(allowed).length === 0) {
        throw new HTTPException(400, { message: 'Cannot modify system resource' })
      }
      board.projects.update(id, allowed)
    } else {
      board.projects.update(id, body)
    }
    const updated = board.projects.get(id)
    return c.json({ project: updated })
  })

  app.delete('/api/v1/projects/:id', requirePermission('delete', 'Project'), (c) => {
    const id = c.req.param('id')
    const existing = board.projects.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Project not found' })
    }
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot delete system resource' })
    }
    board.projects.delete(id)
    return c.json({ message: 'Project deleted' })
  })

  // ─── Board View (kanban data) ─────────────────────────

  app.get('/api/v1/projects/:id/board', requirePermission('read', 'Project'), (c) => {
    const id = c.req.param('id')
    const userId = (c as any).get('userId')
    if (!userId) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Always use global stages — all projects share the same stage set.
    // Scope conversations to the requesting user: conversations are private,
    // exactly like the direct /api/v1/conversations routes.
    const projectStages = board.stages.listGlobal()

    // Sentinel "all" — every project's root conversations on the shared stage set.
    if (id === 'all') {
      const stages = projectStages.map((stage) => ({
        ...stage,
        conversations: enrich(conversationService.listByStage(stage.id, userId)),
      }))
      return c.json({
        project: { id: 'all', name: 'All', color: null, prompt: null, typeId: null },
        stages,
      })
    }

    const project = board.projects.getWithStages(id)
    if (!project) {
      throw new HTTPException(404, { message: 'Project not found' })
    }
    const stages = projectStages.map((stage) => ({
      ...stage,
      conversations: enrich(conversationService.listByProject(id, stage.id, userId)),
    }))
    return c.json({ project, stages })
  })

  // ─── Project Conversations ────────────────────────────

  app.post('/api/v1/projects/:id/conversations', requirePermission('create', 'Conversation'), async (c) => {
    const projectId = c.req.param('id')
    const project = board.projects.getWithStages(projectId)
    if (!project) {
      throw new HTTPException(404, { message: 'Project not found' })
    }

    const body = await c.req.json()
    const userId = (c as any).get('userId')
    if (!userId) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const conv = conversationService.create({
      userId,
      title: body.title,
      providerId: body.providerId,
      modelId: body.modelId,
    })

    // Assign to first non-closed stage + inherit default agent
    const firstOpenStage = project.stages.find((s) => !s.isClosed) ?? project.stages[0]
    const targetStageId = body.stageId ?? firstOpenStage?.id
    // Default code-search pin from project.indexedSources (search source IDs)
    const searchContext =
      body.searchContext !== undefined
        ? body.searchContext
        : project.indexedSources?.length
          ? { sourceIds: [...project.indexedSources] }
          : null

    conversationService.update(conv.id, {
      projectId,
      stageId: targetStageId ?? undefined,
      position: 1.0,
      priority: body.priority,
      agentId: body.agentId ?? project.defaultAgentId ?? undefined,
      searchContext,
    })

    const updated = conversationService.get(conv.id)
    return c.json({ conversation: updated }, 201)
  })

  // ─── Project Stages ───────────────────────────────────

  app.post('/api/v1/projects/:id/stages', requirePermission('create', 'Stage'), async (c) => {
    const projectId = c.req.param('id')
    const project = board.projects.get(projectId)
    if (!project) {
      throw new HTTPException(404, { message: 'Project not found' })
    }

    const body = await c.req.json()
    if (!body.name) {
      throw new HTTPException(400, { message: 'Name is required' })
    }

    const stage = board.stages.create({
      projectId,
      name: body.name,
      color: body.color,
      sortOrder: body.sortOrder,
      isClosed: body.isClosed,
      autoAssigneeId: body.autoAssigneeId,
    })
    return c.json({ stage }, 201)
  })

  app.patch('/api/v1/projects/:id/stages/reorder', requirePermission('update', 'Stage'), async (c) => {
    const projectId = c.req.param('id')
    const project = board.projects.get(projectId)
    if (!project) {
      throw new HTTPException(404, { message: 'Project not found' })
    }

    const body = await c.req.json()
    if (!Array.isArray(body.stageIds)) {
      throw new HTTPException(400, { message: 'stageIds array is required' })
    }

    board.stages.reorder(projectId, body.stageIds)
    const stages = board.stages.listByProject(projectId)
    return c.json({ stages })
  })

  // ─── Global Stages (project_id IS NULL) ────────────────

  app.get('/api/v1/stages', requirePermission('read', 'Stage'), (c) => {
    const stages = board.stages.listGlobal()
    return c.json({ stages })
  })

  app.post('/api/v1/stages', requirePermission('create', 'Stage'), async (c) => {
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const stage = board.stages.create({
      projectId: null,
      name: body.name,
      color: body.color,
      sortOrder: body.sortOrder,
      isClosed: body.isClosed,
      isFolded: body.isFolded,
      botListen: body.botListen,
      autoAssigneeId: body.autoAssigneeId,
    })
    return c.json({ stage }, 201)
  })

  app.patch('/api/v1/stages/reorder', requirePermission('update', 'Stage'), async (c) => {
    const body = await c.req.json()
    if (!Array.isArray(body.ids)) throw new HTTPException(400, { message: 'ids array required' })
    board.stages.reorder(null, body.ids)
    const stages = board.stages.listGlobal()
    return c.json({ stages })
  })

  // ─── Stages (by ID) ──────────────────────────────────

  app.patch('/api/v1/stages/:id', requirePermission('update', 'Stage'), async (c) => {
    const id = c.req.param('id')
    const existing = board.stages.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Stage not found' })
    }
    const body = await c.req.json()
    board.stages.update(id, body)
    const updated = board.stages.get(id)
    return c.json({ stage: updated })
  })

  app.delete('/api/v1/stages/:id', requirePermission('delete', 'Stage'), (c) => {
    const id = c.req.param('id')
    const existing = board.stages.get(id)
    if (!existing) {
      throw new HTTPException(404, { message: 'Stage not found' })
    }
    board.stages.delete(id)
    return c.json({ message: 'Stage deleted' })
  })

  // ─── Conversation Move (drag & drop) ──────────────────

  app.patch('/api/v1/conversations/:id/move', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const conv = conversationService.get(id)
    if (!conv) {
      throw new HTTPException(404, { message: 'Conversation not found' })
    }

    const userId = (c as any).get('userId')
    if (conv.userId !== userId) {
      throw new HTTPException(403, { message: 'Not authorized' })
    }

    const body = await c.req.json()
    const updateFields: Record<string, any> = {}
    if (body.stageId !== undefined) updateFields.stageId = body.stageId
    if (body.position !== undefined) updateFields.position = body.position
    if (body.projectId !== undefined) updateFields.projectId = body.projectId

    conversationService.update(id, updateFields)
    const updated = conversationService.get(id)
    return c.json({ conversation: updated })
  })

  // ─── Tag Categories ───────────────────────────────────

  app.get('/api/v1/tag-categories', requirePermission('read', 'Tag'), (c) => {
    const projectId = c.req.query('projectId')
    const categories = board.tags.listCategories(projectId ?? undefined)
    return c.json({ tagCategories: categories })
  })

  app.post('/api/v1/tag-categories', requirePermission('create', 'Tag'), async (c) => {
    const body = await c.req.json()
    if (!body.name) {
      throw new HTTPException(400, { message: 'Name is required' })
    }
    const category = board.tags.createCategory(body)
    return c.json({ tagCategory: category }, 201)
  })

  app.patch('/api/v1/tag-categories/:id', requirePermission('update', 'Tag'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    board.tags.updateCategory(id, body)
    return c.json({ message: 'Tag category updated' })
  })

  app.delete('/api/v1/tag-categories/:id', requirePermission('delete', 'Tag'), (c) => {
    const id = c.req.param('id')
    board.tags.deleteCategory(id)
    return c.json({ message: 'Tag category deleted' })
  })

  // ─── Tags ─────────────────────────────────────────────

  app.get('/api/v1/tags', requirePermission('read', 'Tag'), (c) => {
    const projectId = c.req.query('projectId')
    const tags = board.tags.listTags(projectId ?? undefined)
    return c.json({ tags })
  })

  app.post('/api/v1/tags', requirePermission('create', 'Tag'), async (c) => {
    const body = await c.req.json()
    if (!body.name) {
      throw new HTTPException(400, { message: 'Name is required' })
    }
    const tag = board.tags.createTag(body)
    return c.json({ tag }, 201)
  })

  app.patch('/api/v1/tags/:id', requirePermission('update', 'Tag'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    board.tags.updateTag(id, body)
    return c.json({ message: 'Tag updated' })
  })

  app.delete('/api/v1/tags/:id', requirePermission('delete', 'Tag'), (c) => {
    const id = c.req.param('id')
    board.tags.deleteTag(id)
    return c.json({ message: 'Tag deleted' })
  })

  // ─── Conversation Tags ────────────────────────────────

  app.get('/api/v1/conversations/:id/tags', requirePermission('read', 'Conversation'), (c) => {
    const id = c.req.param('id')
    const conv = conversationService.get(id)
    if (!conv) {
      throw new HTTPException(404, { message: 'Conversation not found' })
    }
    const tags = board.tags.getConversationTags(id)
    return c.json({ tags })
  })

  app.put('/api/v1/conversations/:id/tags', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const conv = conversationService.get(id)
    if (!conv) {
      throw new HTTPException(404, { message: 'Conversation not found' })
    }
    const body = await c.req.json()
    if (!Array.isArray(body.tagIds)) {
      throw new HTTPException(400, { message: 'tagIds array is required' })
    }
    board.tags.setConversationTags(id, body.tagIds)
    const tags = board.tags.getConversationTags(id)
    return c.json({ tags })
  })
}
