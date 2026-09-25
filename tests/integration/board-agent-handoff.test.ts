// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import { createToolContractHarness } from '../helpers/tool-contract'
import { createLocalBus } from '@core/bus/local-bus'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import { createStageAutomation } from '@modules/board/stage-automation'
import { createBotExecutor } from '@modules/proactive-assistant/bot-executor'
import { createAssignTaskTool } from '@modules/tools/builtin/assign-task-tool'
import { createHandoffTool } from '@modules/tools/builtin/handoff-tool'
import { runConversation } from '@modules/agent/conversation-runner'
import { wireHandoffRuns } from '@modules/agent/handoff-run'
import type { RunConversationEntry } from '@modules/agent/run-deps'

/**
 * Board → agent handoff, end to end over the REAL bus.
 *
 * The two halves of R8 were each finished but never connected: nothing set
 * status='waiting', and the executor only ever woke on a 10-minute cron. This
 * exercises the whole chain in one process — a stage move (or an assign_task
 * call) arms the card, the arming event kicks the executor, and the executor
 * starts a background run labelled origin 'scheduled'.
 */

const testDb = createTestDb('board-agent-handoff')
let db: ReturnType<typeof testDb.open>
let bus: ReturnType<typeof createLocalBus>
let stages: ReturnType<typeof createStageService>
let projects: ReturnType<typeof createProjectService>
let conversations: ReturnType<typeof createConversationService>
let agents: ReturnType<typeof createAgentRegistry>
let botExecutor: ReturnType<typeof createBotExecutor>
let agentRunner: { run: ReturnType<typeof vi.fn> }
let buildForPrimary: ReturnType<typeof vi.fn>
let runEntry: RunConversationEntry
let logger: any
let kicks: number

function asyncEvents(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

/** Waits for the fire-and-forget bus handlers (and the kick they trigger). */
const settle = () => new Promise(r => setTimeout(r, 30))

beforeEach(() => {
  db = testDb.open()
  bus = createLocalBus()
  kicks = 0
  logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }

  const projectTypes = createProjectTypeService(db)
  projects = createProjectService(db, projectTypes)
  stages = createStageService(db)
  conversations = createConversationService(db, bus)
  agents = createAgentRegistry(db)
  agents.create({
    id: 'worker-1', name: 'Worker One', role: 'worker', description: 'works', goal: 'work',
    backstory: '', systemPrompt: 'You work', capabilities: [], tools: [], constraints: [], maxTurns: 5,
  })

  agentRunner = { run: vi.fn().mockReturnValue(asyncEvents([{ type: 'turn_complete', tokensUsed: 100 }])) }
  // The prompt assembler builds the run's turn block; its turnText is the
  // recall query.
  buildForPrimary = vi.fn(async () => ({ prefix: 'P', suffix: '', reminders: [], sections: [], prefixHash: 'h', turn: 'T' }))
  // Production: ctx.agents.runConversation, the one runner entry (run-deps.ts).
  runEntry = (id, overrides) => runConversation(id, {
    db,
    agentRunner,
    agentRegistry: agents,
    toolRegistry: { toToolDefinitions: () => [] },
    logger,
    promptAssembler: { buildForPrimary } as any,
  }, overrides)
  botExecutor = createBotExecutor({ db, logger, runConversation: runEntry })

  // Production wiring: board/index.ts subscribes the automation to stage
  // changes; proactive-assistant/index.ts kicks the executor on both arming
  // signals (the cron stays behind as a crash-recovery sweep).
  const automation = createStageAutomation({ stages, projects, conversations, bus, logger })
  bus.on('eyas.conversations.stage_changed', async (data) => { await automation.handleStageChanged(data as any) })
  const kick = async () => { kicks++; await botExecutor.processWaiting() }
  bus.on('eyas.board.card_armed', kick)
  bus.on('eyas.board.task_assigned', kick)
  // agent/index.ts: a hand-off starts the colleague's home thread.
  wireHandoffRuns({ bus, db, runConversation: () => runEntry, logger })
})

afterEach(() => testDb.cleanup())

describe('board → agent handoff', () => {
  it('a card dragged into a bot stage arms, kicks the executor, and runs with origin scheduled', async () => {
    const project = projects.create({ name: 'Infra', defaultAgentId: 'worker-1' })
    stages.create({ projectId: null, name: 'Backlog', sortOrder: 0 })
    const botStage = stages.create({ projectId: null, name: 'To Do', sortOrder: 1, botListen: true })

    const card = conversations.create({ userId: 'user-1' })
    conversations.update(card.id, { projectId: project.id, prompt: 'Rotate the expiring certs' })

    // The drag itself — exactly what PATCH /conversations/:id/move does.
    conversations.update(card.id, { stageId: botStage.id })
    await settle()

    expect(kicks).toBeGreaterThan(0)
    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    const call = agentRunner.run.mock.calls[0][0]
    expect(call.messages).toEqual([{ role: 'user', content: 'Rotate the expiring certs' }])
    expect(call.metadata.origin).toBe('scheduled')
    expect(call.metadata.autonomous).toBe(true)
    expect(call.metadata.agentId).toBe('worker-1')

    // The run completed and released the card.
    const after = conversations.get(card.id)!
    expect(after.status).toBe('idle')
    expect(after.mode).toBe('managed')
    expect(after.agentId).toBe('worker-1')
    expect(after.goalDescription).toBe('Rotate the expiring certs')
  })

  it('a card in an auto-assignee stage is armed with that stage agent', async () => {
    const botStage = stages.create({ projectId: null, name: 'Auto', autoAssigneeId: 'worker-1' })
    const card = conversations.create({ userId: 'user-1' })
    conversations.update(card.id, { title: 'Investigate the alert' })

    conversations.update(card.id, { stageId: botStage.id })
    await settle()

    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    expect(agentRunner.run.mock.calls[0][0].messages[0].content).toBe('Investigate the alert')
    expect(conversations.get(card.id)!.agentId).toBe('worker-1')
  })

  it('assign_task hands a task to another agent and the target run fires without a cron tick', async () => {
    const project = projects.create({ name: 'Infra' })
    const botStage = stages.create({ projectId: null, name: 'To Do', botListen: true })

    const parent = conversations.create({ userId: 'user-1' })
    conversations.update(parent.id, { projectId: project.id })

    const harness = createToolContractHarness(
      createAssignTaskTool({
        getConversations: () => conversations,
        getStages: () => stages,
        registry: agents,
        bus,
      }),
    )

    const r = await harness.run(
      'assign_task',
      { agentId: 'worker-1', title: 'Ship the release', goalDescription: 'Cut a release and publish it' },
      { conversationId: parent.id, agentId: 'coordinator' },
    )
    await settle()

    const out = r.output as any
    expect(out.assigned).toBe(true)
    expect(out.stageId).toBe(botStage.id)

    expect(kicks).toBeGreaterThan(0)
    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    const call = agentRunner.run.mock.calls[0][0]
    expect(call.messages).toEqual([{ role: 'user', content: 'Cut a release and publish it' }])
    expect(call.metadata.conversationId).toBe(out.conversationId)
    expect(call.metadata.origin).toBe('scheduled')

    const child = conversations.get(out.conversationId)!
    expect(child.parentConversationId).toBe(parent.id)
    expect(child.status).toBe('idle') // run finished
  })

  it('leaves an unrunnable card alone — no agent, no run, no status churn', async () => {
    const botStage = stages.create({ projectId: null, name: 'To Do', botListen: true })
    const card = conversations.create({ userId: 'user-1' })
    conversations.update(card.id, { title: 'Nobody assigned' })

    conversations.update(card.id, { stageId: botStage.id })
    await settle()

    expect(agentRunner.run).not.toHaveBeenCalled()
    expect(conversations.get(card.id)!.status).toBe('idle')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('colleague hand-off → the colleague runs (I10)', () => {
  beforeEach(() => {
    agents.create({
      id: 'lead', name: 'Lead', role: 'lead', description: 'leads', goal: 'lead', backstory: '', tier: 'primary',
      systemPrompt: 'You lead', capabilities: [], tools: [], constraints: [], maxTurns: 5,
    } as any)
    agents.create({
      id: 'engineer', name: 'Engineer', role: 'engineer', description: 'builds', goal: 'build', backstory: '', tier: 'team',
      systemPrompt: 'You build', capabilities: [], tools: [], constraints: [], maxTurns: 5,
    } as any)
    agents.create({
      id: 'reviewer', name: 'Reviewer', role: 'reviewer', description: 'reviews', goal: 'review', backstory: '', tier: 'specialist',
      systemPrompt: 'You review', capabilities: [], tools: [], constraints: [], maxTurns: 5,
    } as any)
  })

  function handoffHarness() {
    return createToolContractHarness(createHandoffTool({ getConversations: () => conversations, registry: agents, bus }))
  }

  it('(+) starts the colleague run in their home thread with the brief as goal and recall query', async () => {
    const parent = conversations.create({ userId: 'user-1' })
    const r = await handoffHarness().run(
      'handoff_to_colleague',
      { agentId: 'engineer', reason: 'owns the platform', summary: 'Fix the boot order of the scheduler.' },
      { conversationId: parent.id, agentId: 'lead', userId: 'user-1' },
    )
    await settle()

    const out = r.output as any
    expect(out.handedOff).toBe(true)
    const home = conversations.get(out.conversationId)!
    expect(home.kind).toBe('home')
    const brief = home.goalDescription!
    expect(brief).toContain('Fix the boot order of the scheduler.')

    expect(agentRunner.run).toHaveBeenCalledTimes(1)
    const call = agentRunner.run.mock.calls[0][0]
    expect(call.messages).toEqual([{ role: 'user', content: brief }])
    expect(call.metadata).toMatchObject({ conversationId: home.id, agentId: 'engineer', autonomous: true })
    expect(call.autonomous).toBe(true)
    // Recall is queried with the brief, not with whatever a human types later.
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ conversationId: home.id, turnText: brief }))
    // The run finished and released the thread.
    expect(conversations.get(home.id)!.status).toBe('idle')
  })

  it('(−) a hand-off to yourself or to a specialist is still refused, and nothing runs', async () => {
    const parent = conversations.create({ userId: 'user-1' })
    const harness = handoffHarness()
    const self = await harness.run(
      'handoff_to_colleague',
      { agentId: 'lead', reason: 'me', summary: 'Do it yourself.' },
      { conversationId: parent.id, agentId: 'lead', userId: 'user-1' },
    )
    const specialist = await harness.run(
      'handoff_to_colleague',
      { agentId: 'reviewer', reason: 'review', summary: 'Review the diff.' },
      { conversationId: parent.id, agentId: 'lead', userId: 'user-1' },
    )
    await settle()

    expect((self.output as any).error).toMatch(/yourself/)
    expect((specialist.output as any).error).toMatch(/run_specialist/)
    expect(agentRunner.run).not.toHaveBeenCalled()
  })

  it('(−) a duplicate task_assigned for a running thread does not start a second run', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    agentRunner.run.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await gate
        yield { type: 'turn_complete', tokensUsed: 1 }
      },
    }))
    const parent = conversations.create({ userId: 'user-1' })
    const r = await handoffHarness().run(
      'handoff_to_colleague',
      { agentId: 'engineer', reason: 'owns it', summary: 'Rotate the certificates.' },
      { conversationId: parent.id, agentId: 'lead', userId: 'user-1' },
    )
    const homeId = (r.output as any).conversationId as string
    await settle()
    expect(conversations.get(homeId)!.status).toBe('working')

    // The same event again while the colleague is still working.
    bus.emit('eyas.board.task_assigned', {
      conversationId: homeId, targetId: homeId, agentId: 'engineer', handoffFromConversationId: parent.id,
    })
    // And a second hand-off to the busy colleague is refused, not re-armed.
    const again = await handoffHarness().run(
      'handoff_to_colleague',
      { agentId: 'engineer', reason: 'owns it', summary: 'Also renew the DNS records.' },
      { conversationId: parent.id, agentId: 'lead', userId: 'user-1' },
    )
    await settle()

    expect((again.output as any).busy).toBe(true)
    expect(agentRunner.run).toHaveBeenCalledTimes(1)

    release()
    await settle()
    expect(conversations.get(homeId)!.status).toBe('idle')
  })

  it('(−) a board task_assigned without a hand-off origin is left to the bot-executor', async () => {
    const card = conversations.create({ userId: 'user-1' })
    conversations.update(card.id, { agentId: 'engineer', goalDescription: 'Not a hand-off', status: 'waiting', mode: 'managed' })

    bus.emit('eyas.board.task_assigned', { conversationId: card.id, agentId: 'engineer' })
    await settle()

    // No bot stage holds the card and it is not a hand-off: nothing runs it.
    expect(agentRunner.run).not.toHaveBeenCalled()
    expect(conversations.get(card.id)!.status).toBe('waiting')
  })
})

