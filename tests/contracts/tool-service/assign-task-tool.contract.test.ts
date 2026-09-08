// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { buildProductionToolRegistry } from '../../helpers/production-tool-registry'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import { createAssignTaskTool } from '@modules/tools/builtin/assign-task-tool'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import { DESTRUCTIVE_TOOLS } from '@modules/agent/conversation-runner'

/**
 * Contract test: `assign_task` against the REAL conversation, stage, project
 * and agent-registry services — the async counterpart of delegate_to_agent.
 * The tool hands a task to another agent and RETURNS immediately; the card is
 * parked in a bot-capable stage with status 'waiting' for the bot-executor to
 * claim. Every failure is an in-band teaching error, never a throw.
 */

const testDb = createTestDb('assign-task-contract')
let db: ReturnType<typeof testDb.open>
let stages: ReturnType<typeof createStageService>
let projects: ReturnType<typeof createProjectService>
let conversations: ReturnType<typeof createConversationService>
let agents: ReturnType<typeof createAgentRegistry>
let events: Array<{ subject: string; data: any }>
let harness: ToolContractHarness
let parentId: string

const agentInput = {
  role: 'worker',
  description: 'does work',
  goal: 'work',
  backstory: '',
  systemPrompt: 'You work',
  capabilities: [],
  tools: [],
  constraints: [],
}

function build(overrides: { getStages?: () => any; getConversations?: () => any } = {}) {
  return createToolContractHarness(
    createAssignTaskTool({
      getConversations: overrides.getConversations ?? (() => conversations),
      getStages: overrides.getStages ?? (() => stages),
      registry: agents,
      bus: { emit: (subject: string, data: unknown) => { events.push({ subject, data }) }, on: () => ({}) } as any,
    }),
  )
}

const assigned = () => events.filter(e => e.subject === 'eyas.board.task_assigned')

/** Runs assign_task with the caller's conversation as the parent card. */
function run(h: ToolContractHarness, input: Record<string, unknown>, conversationId?: string) {
  return h.run('assign_task', input, { conversationId: conversationId ?? parentId })
}

beforeEach(() => {
  db = testDb.open()
  events = []
  const projectTypes = createProjectTypeService(db)
  projects = createProjectService(db, projectTypes)
  stages = createStageService(db)
  conversations = createConversationService(db)
  agents = createAgentRegistry(db)

  agents.create({ ...agentInput, id: 'worker-1', name: 'Worker One' })
  agents.create({ ...agentInput, id: 'worker-off', name: 'Sleepy Worker', enabled: false })

  const project = projects.create({ name: 'Infra' })
  const parent = conversations.create({ userId: 'user-1' })
  conversations.update(parent.id, { projectId: project.id })
  parentId = parent.id

  harness = build()
})

afterEach(() => testDb.cleanup())

describe('assign_task ↔ conversation/stage/agent service contract', () => {
  it('parks a waiting child in the first bot-capable stage and emits task_assigned', async () => {
    stages.create({ projectId: null, name: 'Backlog', sortOrder: 0 })
    const botStage = stages.create({ projectId: null, name: 'To Do', sortOrder: 1, botListen: true })

    const r = await run(harness, { agentId: 'worker-1', title: 'Rotate the certs', goalDescription: 'Rotate every expiring TLS cert' }, parentId)

    expect(r.success).toBe(true)
    const out = r.output as any
    expect(out.error).toBeUndefined()
    expect(out.assigned).toBe(true)
    expect(out.stageId).toBe(botStage.id)
    expect(out.note).toMatch(/get_conversation_status/)

    const child = conversations.get(out.conversationId)!
    expect(child.status).toBe('waiting')
    expect(child.mode).toBe('managed')
    expect(child.agentId).toBe('worker-1')
    expect(child.goalDescription).toBe('Rotate every expiring TLS cert')
    expect(child.title).toBe('Rotate the certs')
    expect(child.stageId).toBe(botStage.id)
    expect(child.parentConversationId).toBe(parentId)
    // The child inherits the parent's board context through createSubConversation.
    expect(child.projectId).toBe(conversations.get(parentId)!.projectId)
    expect(out.taskId).toBe(child.taskId)

    expect(assigned()).toHaveLength(1)
    expect(assigned()[0].data).toEqual({
      conversationId: child.id,
      targetId: child.id,
      projectId: child.projectId,
      stageId: botStage.id,
      agentId: 'worker-1',
      assignedByAgentId: 'contract-a1',
      userId: 'user-1',
    })
  })

  it('honours an explicit bot-capable stage and the optional priority/dueDate', async () => {
    stages.create({ projectId: null, name: 'To Do', sortOrder: 0, botListen: true })
    const autoStage = stages.create({ projectId: null, name: 'Auto', sortOrder: 1, autoAssigneeId: 'worker-1' })

    const r = await run(harness, {
        agentId: 'worker-1',
        title: 'Ship it',
        goalDescription: 'Ship the release',
        stageId: autoStage.id,
        priority: 'urgent',
        dueDate: '2026-08-01',
      }, parentId)

    const out = r.output as any
    expect(out.error).toBeUndefined()
    expect(out.stageId).toBe(autoStage.id)

    const child = conversations.get(out.conversationId)!
    expect(child.stageId).toBe(autoStage.id)
    expect(child.priority).toBe('urgent')
    expect(child.dueDate).toBe('2026-08-01')
  })

  it('refuses an unknown stage without creating a child', async () => {
    stages.create({ projectId: null, name: 'To Do', botListen: true })
    const before = conversations.getChildren(parentId).length

    const r = await run(harness, { agentId: 'worker-1', title: 'T', goalDescription: 'G', stageId: 'no-such-stage' }, parentId)

    expect((r.output as any).error).toMatch(/stage/i)
    expect(conversations.getChildren(parentId)).toHaveLength(before)
    expect(assigned()).toHaveLength(0)
  })

  it('refuses an explicit stage that no bot watches, and teaches which stages work', async () => {
    const bot = stages.create({ projectId: null, name: 'To Do', botListen: true })
    const plain = stages.create({ projectId: null, name: 'Backlog' })

    const r = await run(harness, { agentId: 'worker-1', title: 'T', goalDescription: 'G', stageId: plain.id }, parentId)

    const out = r.output as any
    expect(out.error).toMatch(/not watched by any agent/i)
    expect(out.botCapableStages.map((s: any) => s.id)).toEqual([bot.id])
    expect(conversations.getChildren(parentId)).toHaveLength(0)
  })

  it('refuses an unknown agent id and lists the enabled agents', async () => {
    stages.create({ projectId: null, name: 'To Do', botListen: true })

    const r = await run(harness, { agentId: 'backend-developer', title: 'T', goalDescription: 'G' }, parentId)

    const out = r.output as any
    expect(out.error).toMatch(/not found/i)
    expect(out.availableAgents.map((a: any) => a.id)).toEqual(['worker-1'])
    expect(conversations.getChildren(parentId)).toHaveLength(0)
  })

  it('refuses a disabled agent', async () => {
    stages.create({ projectId: null, name: 'To Do', botListen: true })

    const r = await run(harness, { agentId: 'worker-off', title: 'T', goalDescription: 'G' }, parentId)

    expect((r.output as any).error).toMatch(/not enabled/i)
    expect(conversations.getChildren(parentId)).toHaveLength(0)
  })

  it('returns a configuration teaching error when no stage is bot-capable', async () => {
    stages.create({ projectId: null, name: 'Backlog' })

    const r = await run(harness, { agentId: 'worker-1', title: 'T', goalDescription: 'G' }, parentId)

    const out = r.output as any
    expect(out.error).toMatch(/no bot-capable stage/i)
    expect(conversations.getChildren(parentId)).toHaveLength(0)
    expect(assigned()).toHaveLength(0)
  })

  it('rejects malformed input at the executor with INVALID_INPUT (Zod)', async () => {
    stages.create({ projectId: null, name: 'To Do', botListen: true })

    const r = await run(harness, { agentId: 'worker-1', goalDescription: 'G' })

    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('INVALID_INPUT')
    expect(conversations.getChildren(parentId)).toHaveLength(0)
  })

  it('enforces the assignment depth cap of 5', async () => {
    stages.create({ projectId: null, name: 'To Do', botListen: true })

    // root + 4 descendants = an ancestry chain of 5 at the deepest node.
    let deepest = parentId
    for (let i = 0; i < 4; i++) {
      deepest = conversations.createSubConversation({
        title: `level ${i}`,
        goalDescription: 'g',
        parentConversationId: deepest,
      }).id
    }
    expect(conversations.getAncestry(deepest)).toHaveLength(5)

    const r = await run(harness, { agentId: 'worker-1', title: 'T', goalDescription: 'G' }, deepest)

    expect((r.output as any).error).toMatch(/depth/i)
    expect(conversations.getChildren(deepest)).toHaveLength(0)
    expect(assigned()).toHaveLength(0)
  })

  it('fails soft when the board or conversations module is not started yet', async () => {
    const noStages = build({ getStages: () => undefined })
    const r1 = await run(noStages, { agentId: 'worker-1', title: 'T', goalDescription: 'G' })
    expect(r1.success).toBe(true)
    expect((r1.output as any).error).toMatch(/not ready/i)

    const noConvs = build({ getConversations: () => undefined })
    const r2 = await run(noConvs, { agentId: 'worker-1', title: 'T', goalDescription: 'G' })
    expect((r2.output as any).error).toMatch(/not ready/i)
  })

  it('is pinned as yellow in all three lists that classify it', async () => {
    // Registry tier (what the gate's fallback reads), the config-declared
    // deterministic tier, and the runner's destructive-tool hard-guard must
    // agree — a tool that drifts out of any one of them silently changes its
    // security posture.
    const registry = await buildProductionToolRegistry()
    expect(registry.get('assign_task')?.riskTier).toBe('yellow')
    expect(DEFAULT_CONFIG.riskTiers.yellow).toContain('assign_task')
    expect(DESTRUCTIVE_TOOLS).toContain('assign_task')
  })
})
