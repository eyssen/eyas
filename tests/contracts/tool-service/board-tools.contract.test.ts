// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createTagService } from '@modules/board/services/tag-service'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createBoardTools } from '@modules/tools/builtin/board-tools'

/**
 * Contract test: the board tools against the REAL board + conversation
 * services. Both tools were dead — `service.listProjects()` and
 * `service.moveToStage()` do not exist on the object board.onRegister
 * publishes (`{ projectTypes, projects, stages, tags }`).
 *
 * `move_to_stage` MUST route through conversations.update() rather than raw
 * SQL: that is what emits `eyas.conversations.stage_changed`, which the
 * documents retention lifecycle and the board stage automation consume.
 */

const testDb = createTestDb('board-tools-contract')
let db: ReturnType<typeof testDb.open>
let board: { projectTypes: any; projects: any; stages: any; tags: any }
let conversations: ReturnType<typeof createConversationService>
let events: Array<{ name: string; data: any }>
let harness: ToolContractHarness

beforeEach(() => {
  db = testDb.open()
  events = []
  const bus: any = {
    emit: (name: string, data: any) => { events.push({ name, data }) },
    on: () => {},
  }

  const projectTypes = createProjectTypeService(db)
  board = {
    projectTypes,
    projects: createProjectService(db, projectTypes),
    stages: createStageService(db),
    tags: createTagService(db),
  }
  conversations = createConversationService(db, bus)

  harness = createToolContractHarness(
    createBoardTools({ getBoard: () => board, getConversations: () => conversations }),
  )
})

afterEach(() => testDb.cleanup())

describe('board tools ↔ board/conversation service contract', () => {
  it('list_projects returns the real projects with their type', async () => {
    const type = board.projectTypes.create({ name: 'Bug Tracker', defaultStages: ['New', 'Done'] })
    board.projects.create({ name: 'Infra', description: 'Cluster work', typeId: type.id })
    board.projects.create({ name: 'Standalone' })

    const r = await harness.run('list_projects', {})

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.projects).toHaveLength(2)

    const infra = output.projects.find((p: any) => p.name === 'Infra')
    expect(infra.id).toBeTruthy()
    expect(infra.description).toBe('Cluster work')
    expect(infra.typeId).toBe(type.id)
  })

  it('move_to_stage moves the conversation AND emits stage_changed on the bus', async () => {
    const project = board.projects.create({ name: 'Infra' })
    const from = board.stages.create({ projectId: project.id, name: 'To Do' })
    const to = board.stages.create({ projectId: project.id, name: 'In Progress' })
    const conv = conversations.create({ userId: 'user-1' })
    conversations.update(conv.id, { projectId: project.id, stageId: from.id })
    events.length = 0

    const r = await harness.run('move_to_stage', { conversationId: conv.id, stageId: to.id })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.moved).toBe(true)
    expect(conversations.get(conv.id)!.stageId).toBe(to.id)

    const stageEvents = events.filter(e => e.name === 'eyas.conversations.stage_changed')
    expect(stageEvents).toHaveLength(1)
    expect(stageEvents[0].data.conversationId).toBe(conv.id)
    expect(stageEvents[0].data.fromStageId).toBe(from.id)
    expect(stageEvents[0].data.toStageId).toBe(to.id)
  })

  it('rejects an unknown conversation without touching the DB or the bus', async () => {
    const project = board.projects.create({ name: 'Infra' })
    const stage = board.stages.create({ projectId: project.id, name: 'Done' })
    events.length = 0

    const r = await harness.run('move_to_stage', { conversationId: 'no-such-conv', stageId: stage.id })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/conversation not found/i)
    expect(events.filter(e => e.name === 'eyas.conversations.stage_changed')).toHaveLength(0)
  })

  it('rejects an unknown stage without moving the conversation', async () => {
    const project = board.projects.create({ name: 'Infra' })
    const stage = board.stages.create({ projectId: project.id, name: 'To Do' })
    const conv = conversations.create({ userId: 'user-1' })
    conversations.update(conv.id, { projectId: project.id, stageId: stage.id })
    events.length = 0

    const r = await harness.run('move_to_stage', { conversationId: conv.id, stageId: 'no-such-stage' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/stage not found/i)
    expect(conversations.get(conv.id)!.stageId).toBe(stage.id)
    expect(events.filter(e => e.name === 'eyas.conversations.stage_changed')).toHaveLength(0)
  })

  it('fails soft (structured error, not throw) when the modules are not started yet', async () => {
    const h = createToolContractHarness(
      createBoardTools({ getBoard: () => undefined, getConversations: () => undefined }),
    )

    const list = await h.run('list_projects', {})
    expect(list.success).toBe(true)
    expect((list.output as any).error).toMatch(/not ready/i)

    const move = await h.run('move_to_stage', { conversationId: 'c', stageId: 's' })
    expect(move.success).toBe(true)
    expect((move.output as any).error).toMatch(/not ready/i)
  })
})
