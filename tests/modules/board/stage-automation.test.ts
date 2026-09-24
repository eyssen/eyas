// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createLocalBus } from '@core/bus/local-bus'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createStageAutomation } from '@modules/board/stage-automation'

/**
 * Stage automation — the producer half of the board→agent trigger.
 *
 * Real services + a real bus + the real conversation service on purpose: the
 * whole defect this closes is a wiring gap (nothing ever set status='waiting',
 * so the bot-executor's poll starved). A mocked conversation service would
 * happily "arm" a card that production never writes.
 */

const testDb = createTestDb('board-stage-automation')
let db: ReturnType<typeof testDb.open>
let bus: ReturnType<typeof createLocalBus>
let stages: ReturnType<typeof createStageService>
let projects: ReturnType<typeof createProjectService>
let conversations: ReturnType<typeof createConversationService>
let logger: { info: any; warn: any; debug: any; error: any }
let events: Array<{ subject: string; data: any }>
let automation: ReturnType<typeof createStageAutomation>

beforeEach(() => {
  db = testDb.open()
  bus = createLocalBus()
  events = []
  // Wildcard tap — records every eyas.* subject so "no re-emit" is provable.
  bus.on('eyas.*', async (data, subject) => { events.push({ subject: subject ?? '?', data }) })

  const projectTypes = createProjectTypeService(db)
  projects = createProjectService(db, projectTypes)
  stages = createStageService(db)
  conversations = createConversationService(db, bus)
  logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }

  automation = createStageAutomation({ stages, projects, conversations, bus, logger: logger as any })
})

afterEach(() => testDb.cleanup())

/** Card in a stage, with the given overrides applied through the real service. */
function makeCard(overrides: Record<string, any> = {}) {
  const conv = conversations.create({ userId: 'user-1' })
  conversations.update(conv.id, overrides)
  return conversations.get(conv.id)!
}

const armed = () => events.filter(e => e.subject === 'eyas.board.card_armed')

describe('stage automation — arming cards for autonomous pickup', () => {
  it('arms a runnable card entering a bot_listen stage', async () => {
    const project = projects.create({ name: 'Infra' })
    const stage = stages.create({ projectId: null, name: 'To Do', botListen: true })
    const card = makeCard({ projectId: project.id, stageId: stage.id, agentId: 'agent-1', goalDescription: 'Fix the cluster' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    const after = conversations.get(card.id)!
    expect(after.status).toBe('waiting')
    expect(after.mode).toBe('managed')
    expect(after.agentId).toBe('agent-1')
    expect(after.goalDescription).toBe('Fix the cluster')
  })

  it('arms an autonomous card WITHOUT demoting it to managed', async () => {
    // The promotion is 'simple'|'agent' → 'managed', never "anything that is
    // not managed". Rewriting it as `mode !== 'managed'` would silently strip
    // a card's autonomous mode — and every other case here would stay green.
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true })
    const card = makeCard({ stageId: stage.id, agentId: 'agent-1', goalDescription: 'Goal', mode: 'autonomous' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    const after = conversations.get(card.id)!
    expect(after.status).toBe('waiting')
    expect(after.mode).toBe('autonomous')
    expect(armed()).toHaveLength(1)
  })

  it('backfills the agent from the stage auto-assignee and the goal from the prompt', async () => {
    const project = projects.create({ name: 'Infra' })
    const stage = stages.create({ projectId: null, name: 'Bot', autoAssigneeId: 'stage-agent' })
    const card = makeCard({ projectId: project.id, stageId: stage.id, title: 'Card title', prompt: 'Do the prompt thing' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    const after = conversations.get(card.id)!
    expect(after.agentId).toBe('stage-agent')
    expect(after.goalDescription).toBe('Do the prompt thing')
    expect(after.status).toBe('waiting')
  })

  it('falls back to the title when the card has no prompt', async () => {
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true, autoAssigneeId: 'stage-agent' })
    const card = makeCard({ stageId: stage.id, title: 'Only a title' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.goalDescription).toBe('Only a title')
  })

  it('NEVER overwrites an agent the card already carries', async () => {
    const stage = stages.create({ projectId: null, name: 'Bot', autoAssigneeId: 'stage-agent' })
    const card = makeCard({ stageId: stage.id, agentId: 'card-agent', goalDescription: 'Goal' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.agentId).toBe('card-agent')
    expect(armed()[0].data.agentId).toBe('card-agent')
  })

  it('falls back down the chain: card → stage auto-assignee → project default agent', async () => {
    const project = projects.create({ name: 'Infra', defaultAgentId: 'project-agent' })
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true })
    const card = makeCard({ projectId: project.id, stageId: stage.id, goalDescription: 'Goal' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.agentId).toBe('project-agent')
  })

  it('does NOT arm an unrunnable card (no agent anywhere in the chain) and warns', async () => {
    const project = projects.create({ name: 'Infra' })
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true })
    const card = makeCard({ projectId: project.id, stageId: stage.id, goalDescription: 'Goal but nobody to run it' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.status).toBe('idle')
    expect(armed()).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('does NOT arm a card with no goal, prompt, or title and warns', async () => {
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true, autoAssigneeId: 'stage-agent' })
    const card = makeCard({ stageId: stage.id })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.status).toBe('idle')
    expect(armed()).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('ignores a plain stage (neither bot_listen nor an auto-assignee)', async () => {
    const stage = stages.create({ projectId: null, name: 'Backlog' })
    const card = makeCard({ stageId: stage.id, agentId: 'agent-1', goalDescription: 'Goal' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    expect(conversations.get(card.id)!.status).toBe('idle')
    expect(armed()).toHaveLength(0)
  })

  it('skips cards that are already working, waiting_approval, archived, or deleted', async () => {
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true })
    for (const status of ['working', 'waiting_approval', 'archived', 'deleted']) {
      const card = makeCard({ stageId: stage.id, agentId: 'agent-1', goalDescription: 'Goal', status })
      events.length = 0

      await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

      expect(conversations.get(card.id)!.status, `status ${status} must be left alone`).toBe(status)
      expect(armed()).toHaveLength(0)
    }
  })

  it('emits exactly one card_armed with the full payload shape', async () => {
    const project = projects.create({ name: 'Infra' })
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true, autoAssigneeId: 'stage-agent' })
    const card = makeCard({ projectId: project.id, stageId: stage.id, goalDescription: 'Goal' })
    events.length = 0

    await automation.handleStageChanged({ conversationId: card.id, fromStageId: null, toStageId: stage.id })

    const emitted = armed()
    expect(emitted).toHaveLength(1)
    expect(emitted[0].data).toEqual({
      conversationId: card.id,
      targetId: card.id,
      projectId: project.id,
      stageId: stage.id,
      agentId: 'stage-agent',
      userId: 'user-1',
    })
  })

  it('does not recurse: arming never re-emits stage_changed', async () => {
    const stage = stages.create({ projectId: null, name: 'Bot', botListen: true, autoAssigneeId: 'stage-agent' })
    const card = makeCard({ stageId: stage.id, goalDescription: 'Goal' })

    // Wire the automation to the bus exactly as board/index.ts does — if the
    // arming write touched stage_id we would loop forever here.
    bus.on('eyas.conversations.stage_changed', async (data) => { await automation.handleStageChanged(data as any) })

    const target = stages.create({ projectId: null, name: 'Bot 2', botListen: true, autoAssigneeId: 'other-agent' })
    events.length = 0
    conversations.update(card.id, { stageId: target.id })
    await new Promise(r => setTimeout(r, 20))

    expect(events.filter(e => e.subject === 'eyas.conversations.stage_changed')).toHaveLength(1)
    expect(armed()).toHaveLength(1)
    expect(conversations.get(card.id)!.stageId).toBe(target.id)
  })
})
