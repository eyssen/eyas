import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService, generateTaskId, type ConversationService } from '@modules/conversations/conversation-service'

const testDb = createTestDb('chat-service')
let db: ReturnType<typeof testDb.open>
let svc: ConversationService

beforeEach(() => {
  db = testDb.open()
  svc = createConversationService(db)
})
afterEach(() => testDb.cleanup())

describe('ConversationService', () => {
  describe('create', () => {
    it('creates a conversation with defaults', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(conv.id).toBeTruthy()
      expect(conv.status).toBe('idle')
      expect(conv.tokensUsed).toBe(0)
      expect(conv.userId).toBe('user-1')
    })

    it('creates with optional title and provider', () => {
      const conv = svc.create({ userId: 'user-1', title: 'Test Chat', providerId: 'openai', modelId: 'gpt-4o' })
      expect(conv.title).toBe('Test Chat')
      expect(conv.providerId).toBe('openai')
      expect(conv.modelId).toBe('gpt-4o')
    })

    it('generates a taskId on creation', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(conv.taskId).toBeTruthy()
      expect(conv.taskId).toHaveLength(8)
      // Verify only safe charset used
      const validChars = /^[23456789abcdefghjkmnpqrstvwxyz]+$/
      expect(conv.taskId).toMatch(validChars)
    })

    it('generates unique taskIds', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const conv = svc.create({ userId: 'user-1' })
        ids.add(conv.taskId)
      }
      expect(ids.size).toBe(50)
    })
  })

  describe('generateTaskId', () => {
    it('returns 8-char string from safe charset', () => {
      const id = generateTaskId()
      expect(id).toHaveLength(8)
      const validChars = /^[23456789abcdefghjkmnpqrstvwxyz]+$/
      expect(id).toMatch(validChars)
    })
  })

  describe('list', () => {
    it('returns conversations excluding deleted', () => {
      svc.create({ userId: 'user-1' })
      svc.create({ userId: 'user-1' })
      const deleted = svc.create({ userId: 'user-1' })
      svc.update(deleted.id, { status: 'deleted' })
      const list = svc.list('user-1')
      expect(list).toHaveLength(2)
    })

    it('filters by status', () => {
      svc.create({ userId: 'user-1' })
      const archived = svc.create({ userId: 'user-1' })
      svc.update(archived.id, { status: 'archived' })
      const active = svc.list('user-1', { excludeArchived: true })
      expect(active).toHaveLength(1)
    })
  })

  describe('get', () => {
    it('returns conversation with messages', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello' })
      svc.addMessage(conv.id, { role: 'assistant', content: 'Hi there!', model: 'gpt-4o', provider: 'openai', tokensIn: 5, tokensOut: 10 })
      const result = svc.get(conv.id)
      expect(result!.messages).toHaveLength(2)
      expect(result!.messages[0].role).toBe('user')
      expect(result!.messages[1].tokensOut).toBe(10)
    })
  })

  describe('addMessage', () => {
    it('saves message and updates tokens_used on conversation', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello', tokensIn: 5 })
      svc.addMessage(conv.id, { role: 'assistant', content: 'Hi!', tokensIn: 5, tokensOut: 10, model: 'gpt-4o', provider: 'openai' })
      const updated = svc.get(conv.id)
      expect(updated!.tokensUsed).toBe(20)
    })

    // G7 — the per-turn metadata of an assistant reply.
    const meta = {
      outcome: 'max_turns' as const,
      stopReason: 'max_turns' as const,
      usage: { inputTokens: 100, outputTokens: 40, costUsd: 0.002 },
      costSource: 'estimate' as const,
      steps: 3,
      toolCalls: 2,
      binding: { providerId: 'openai', modelId: 'gpt-4o', source: 'conversation' as const },
      notices: [{ code: 'imagesNotVisible' as const, params: { count: 1 } }],
    }

    it('(+) turnMeta round-trips: returned on the new message and on a later read', () => {
      const conv = svc.create({ userId: 'user-1' })
      const saved = svc.addMessage(conv.id, { role: 'assistant', content: 'partial', turnMeta: meta })
      expect(saved.turnMeta).toEqual(meta)
      expect(svc.get(conv.id)!.messages[0].turnMeta).toEqual(meta)
    })

    it('(+) a message without turnMeta reads it as null', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello' })
      expect(svc.get(conv.id)!.messages[0].turnMeta).toBeNull()
    })

    it('(−) an invalid turnMeta is rejected on write and nothing is stored', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(() => svc.addMessage(conv.id, { role: 'assistant', content: 'x', turnMeta: { ...meta, outcome: 'exploded' } as any })).toThrow()
      expect(() => svc.addMessage(conv.id, { role: 'assistant', content: 'x', turnMeta: { ...meta, smuggled: 'field' } as any })).toThrow()
      expect(() => svc.addMessage(conv.id, { role: 'assistant', content: 'x', turnMeta: { ...meta, usage: { inputTokens: -1, outputTokens: 0 } } as any })).toThrow()
      expect(svc.get(conv.id)!.messages).toHaveLength(0)
    })

    it('(−) a stored turn_meta that no longer validates reads as null, with a warning', () => {
      const warnings: unknown[] = []
      const warned = createConversationService(db, undefined, { warn: (obj) => { warnings.push(obj) } })
      const conv = warned.create({ userId: 'user-1' })
      const saved = warned.addMessage(conv.id, { role: 'assistant', content: 'x', turnMeta: meta })
      db.run(sql`UPDATE conversation_messages SET turn_meta = ${'{"outcome":"legacy"}'} WHERE id = ${saved.id}`)
      expect(warned.get(conv.id)!.messages[0].turnMeta).toBeNull()
      db.run(sql`UPDATE conversation_messages SET turn_meta = ${'not json'} WHERE id = ${saved.id}`)
      expect(warned.get(conv.id)!.messages[0].turnMeta).toBeNull()
      expect(warnings).toHaveLength(2)
    })
  })

  // F2 T9 (R1/R7) — the single writer of conversations.total_cost_usd.
  describe('addRunCost', () => {
    it('increments total_cost_usd only when no tokens are passed', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addRunCost(conv.id, { costUsd: 0.05 })
      svc.addRunCost(conv.id, { costUsd: 0.02 })
      const updated = svc.get(conv.id)
      expect(updated!.totalCostUsd).toBeCloseTo(0.07, 6)
      expect(updated!.tokensUsed).toBe(0)
    })

    it('increments both tokens_used and total_cost_usd when tokens is passed', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addRunCost(conv.id, { costUsd: 0.05, tokens: 120 })
      const updated = svc.get(conv.id)
      expect(updated!.totalCostUsd).toBeCloseTo(0.05, 6)
      expect(updated!.tokensUsed).toBe(120)
    })

    it('is a no-op for a zero-cost, zero-token call (no unnecessary write)', () => {
      const conv = svc.create({ userId: 'user-1' })
      const before = svc.get(conv.id)!.updatedAt
      svc.addRunCost(conv.id, { costUsd: 0 })
      const after = svc.get(conv.id)!
      expect(after.totalCostUsd).toBe(0)
      expect(after.updatedAt).toBe(before)
    })
  })

  describe('update', () => {
    it('updates title', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { title: 'New Title' })
      expect(svc.get(conv.id)!.title).toBe('New Title')
    })

    it('updates status', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { status: 'working' })
      expect(svc.get(conv.id)!.status).toBe('working')
    })

    // teamSessionId used to have no branch in the update if-chain: the write
    // was accepted and dropped, and the read side never exposed the column at
    // all, so a team-bound conversation looked unbound to every consumer.
    it('writes teamSessionId and reads it back', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { teamSessionId: 'ts-1' })
      expect(svc.get(conv.id)!.teamSessionId).toBe('ts-1')
    })

    it('clears teamSessionId with null', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { teamSessionId: 'ts-1' })
      svc.update(conv.id, { teamSessionId: null })
      expect(svc.get(conv.id)!.teamSessionId).toBeNull()
    })
  })

  describe('teamSessionId on the read side', () => {
    it('is null on a freshly created conversation', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(conv.teamSessionId).toBeNull()
      expect(svc.get(conv.id)!.teamSessionId).toBeNull()
    })

    it('is inherited by a sub-conversation from its parent', () => {
      const parent = svc.create({ userId: 'user-1' })
      svc.update(parent.id, { teamSessionId: 'ts-7' })

      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'do the sub-task',
        parentConversationId: parent.id,
      })

      // Both the returned object and the persisted row carry the team binding —
      // a subagent's conversation belongs to the same team session as its parent.
      expect(child.teamSessionId).toBe('ts-7')
      expect(svc.get(child.id)!.teamSessionId).toBe('ts-7')
    })

    it('leaves a sub-conversation unbound when the parent has no team session', () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'do the sub-task',
        parentConversationId: parent.id,
      })
      expect(child.teamSessionId).toBeNull()
      expect(svc.get(child.id)!.teamSessionId).toBeNull()
    })
  })

  describe('createSubConversation status + mode', () => {
    it('defaults to status idle (inline-run callers run the child themselves)', () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'inline sub-task',
        parentConversationId: parent.id,
      })
      expect(child.status).toBe('idle')
      expect(svc.get(child.id)!.status).toBe('idle')
    })

    it("honours initialStatus 'waiting' so a background picker can claim the child", () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'async sub-task',
        parentConversationId: parent.id,
        initialStatus: 'waiting',
      })
      expect(child.status).toBe('waiting')
      expect(svc.get(child.id)!.status).toBe('waiting')
    })

    it("writes mode 'managed', not the dead 'agent' literal", () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'sub-task',
        parentConversationId: parent.id,
        agentId: 'agent-1',
      })
      // 'agent' is outside the ConversationMode union and is consumed nowhere;
      // the bot-executor only picks up 'managed' | 'autonomous'.
      expect(child.mode).toBe('managed')
      expect(svc.get(child.id)!.mode).toBe('managed')
    })

    it('writes god_mode = 0 even when the parent is in God Mode (no recursion)', () => {
      const parent = svc.create({ userId: 'user-1' })
      svc.update(parent.id, { godMode: true })
      expect(svc.get(parent.id)!.godMode).toBe(true)

      const child = svc.createSubConversation({
        title: 'God worker',
        goalDescription: 'same task',
        parentConversationId: parent.id,
      })
      expect(child.godMode).toBe(false)
      expect(svc.get(child.id)!.godMode).toBe(false)
    })
  })

  describe('ownsConversation', () => {
    it('is true for the conversation\'s own (human) owner', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(svc.ownsConversation(conv.id, 'user-1')).toBe(true)
    })

    it('is false for a different user', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(svc.ownsConversation(conv.id, 'user-2')).toBe(false)
    })

    it('is false for a non-existent conversation (fail-closed)', () => {
      expect(svc.ownsConversation('does-not-exist', 'user-1')).toBe(false)
    })

    it('walks up to the nearest non-system owner for a system-owned child (team/delegation run)', () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.create({ userId: 'system' })
      svc.update(child.id, { parentConversationId: parent.id })

      expect(svc.ownsConversation(child.id, 'user-1')).toBe(true)
      expect(svc.ownsConversation(child.id, 'user-2')).toBe(false)
    })

    it('walks through MULTIPLE system-owned hops to the human root', () => {
      const root = svc.create({ userId: 'user-1' })
      const mid = svc.create({ userId: 'system' })
      svc.update(mid.id, { parentConversationId: root.id })
      const leaf = svc.create({ userId: 'system' })
      svc.update(leaf.id, { parentConversationId: mid.id })

      expect(svc.ownsConversation(leaf.id, 'user-1')).toBe(true)
      expect(svc.ownsConversation(leaf.id, 'user-2')).toBe(false)
    })

    it('is false when every ancestor is system-owned (no human root to resolve)', () => {
      const orphan = svc.create({ userId: 'system' })
      expect(svc.ownsConversation(orphan.id, 'user-1')).toBe(false)
    })

    it('a sub-conversation inherits its human parent\'s owner directly', () => {
      const parent = svc.create({ userId: 'user-1' })
      const child = svc.createSubConversation({
        title: 'Child',
        goalDescription: 'sub-task',
        parentConversationId: parent.id,
      })
      expect(svc.ownsConversation(child.id, 'user-1')).toBe(true)
    })
  })

  describe('listByProject', () => {
    it('returns conversations with messageCount', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { projectId: 'proj-1', stageId: 'stage-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello' })
      svc.addMessage(conv.id, { role: 'assistant', content: 'Hi!' })
      const list = svc.listByProject('proj-1', 'stage-1')
      expect(list).toHaveLength(1)
      expect(list[0].messageCount).toBe(2)
      expect(list[0].taskId).toBeTruthy()
    })

    it('scopes to the requesting user when userId is provided', () => {
      const a = svc.create({ userId: 'user-a' })
      svc.update(a.id, { projectId: 'proj-1', stageId: 'stage-1' })
      const b = svc.create({ userId: 'user-b' })
      svc.update(b.id, { projectId: 'proj-1', stageId: 'stage-1' })

      // Without userId: legacy behavior returns everyone's conversations
      expect(svc.listByProject('proj-1', 'stage-1')).toHaveLength(2)

      // With userId: only that user's conversations (no cross-user leak)
      const forA = svc.listByProject('proj-1', 'stage-1', 'user-a')
      expect(forA).toHaveLength(1)
      expect(forA[0].id).toBe(a.id)

      const forB = svc.listByProject('proj-1', 'stage-1', 'user-b')
      expect(forB).toHaveLength(1)
      expect(forB[0].id).toBe(b.id)
    })
  })

  describe('softDelete', () => {
    it('sets status to deleted', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.softDelete(conv.id)
      expect(svc.get(conv.id)!.status).toBe('deleted')
    })
  })

  describe('retention lifecycle events', () => {
    function makeBus() {
      const events: { name: string; data: any }[] = []
      const handlers: Record<string, ((data: any) => void)[]> = {}
      const bus: any = {
        emit: (name: string, data: any) => {
          events.push({ name, data })
          for (const h of handlers[name] ?? []) h(data)
        },
        on: (name: string, h: (data: any) => void) => {
          ;(handlers[name] ??= []).push(h)
        },
      }
      return { bus, events }
    }

    it('emits stage_changed when a conversation moves stages', () => {
      const { bus, events } = makeBus()
      const s = createConversationService(db, bus)
      const conv = s.create({ userId: 'user-1' })
      s.update(conv.id, { projectId: 'proj-1', stageId: 'stage-1' })
      const stageEvents = events.filter(e => e.name === 'eyas.conversations.stage_changed')
      expect(stageEvents).toHaveLength(1)
      expect(stageEvents[0].data.conversationId).toBe(conv.id)
      expect(stageEvents[0].data.toStageId).toBe('stage-1')
    })

    it('emits closed when a conversation is archived', () => {
      const { bus, events } = makeBus()
      const s = createConversationService(db, bus)
      const conv = s.create({ userId: 'user-1' })
      s.update(conv.id, { status: 'archived' })
      const closed = events.filter(e => e.name === 'eyas.conversations.closed')
      expect(closed).toHaveLength(1)
      expect(closed[0].data.conversationId).toBe(conv.id)
    })

    it('emits closed on softDelete', () => {
      const { bus, events } = makeBus()
      const s = createConversationService(db, bus)
      const conv = s.create({ userId: 'user-1' })
      s.softDelete(conv.id)
      const closed = events.filter(e => e.name === 'eyas.conversations.closed')
      expect(closed).toHaveLength(1)
      expect(closed[0].data.conversationId).toBe(conv.id)
      expect(closed[0].data.status).toBe('deleted')
    })

    it('does not emit lifecycle events when status stays the same', () => {
      const { bus, events } = makeBus()
      const s = createConversationService(db, bus)
      const conv = s.create({ userId: 'user-1' })
      s.update(conv.id, { title: 'Renamed' })
      expect(events.filter(e => e.name.startsWith('eyas.conversations.'))).toHaveLength(0)
    })
  })
})

describe('ConversationService — model binding (D3)', () => {
  it('create() is pinned by default; sub-conversations and home threads inherit', () => {
    const parent = svc.create({ userId: 'user-1', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(parent.modelBinding).toBe('pinned')
    expect(svc.get(parent.id)!.modelBinding).toBe('pinned')
    const auto = svc.create({ userId: 'user-1', modelBinding: 'auto' })
    expect(svc.get(auto.id)!.modelBinding).toBe('auto')

    const child = svc.createSubConversation({ title: 'c', goalDescription: 'g', parentConversationId: parent.id, agentId: 'a1' })
    expect(child.modelBinding).toBe('inherit')
    expect(svc.get(child.id)!.modelBinding).toBe('inherit')

    const home = svc.getOrCreateHomeThread({ userId: 'user-1', agentId: 'a2', title: 'Home' })
    expect(home.modelBinding).toBe('inherit')
    expect(svc.get(home.id)).toMatchObject({ modelBinding: 'inherit', providerId: null, modelId: null })
  })

  it("a sub-conversation stores the delegating turn's binding, not the parent's raw pair (H4, positive)", () => {
    const parent = svc.create({ userId: 'user-1', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    const child = svc.createSubConversation({
      title: 'c', goalDescription: 'g', parentConversationId: parent.id, agentId: 'a1',
      binding: { providerId: 'claude-code', modelId: 'claude-code-sonnet' },
    })
    expect(child).toMatchObject({ modelBinding: 'inherit', providerId: 'claude-code', modelId: 'claude-code-sonnet' })
    expect(svc.get(child.id)).toMatchObject({ modelBinding: 'inherit', providerId: 'claude-code', modelId: 'claude-code-sonnet' })
  })

  it("without a binding the child stores no pair — the parent's is never copied (H4, negative)", () => {
    const parent = svc.create({ userId: 'user-1', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    const child = svc.createSubConversation({ title: 'c', goalDescription: 'g', parentConversationId: parent.id })
    expect(svc.get(child.id)).toMatchObject({ modelBinding: 'inherit', providerId: null, modelId: null })
    // A half pair is no pair.
    const half = svc.createSubConversation({
      title: 'h', goalDescription: 'g', parentConversationId: parent.id,
      binding: { providerId: 'claude-code', modelId: '' },
    })
    expect(svc.get(half.id)).toMatchObject({ providerId: null, modelId: null })
  })

  it('a sub-conversation can be pinned to its pair (God Mode workers)', () => {
    const parent = svc.create({ userId: 'user-1' })
    const child = svc.createSubConversation({
      title: 'w', goalDescription: 'g', parentConversationId: parent.id, agentId: 'a1',
      binding: { providerId: 'openai', modelId: 'gpt-x' }, modelBinding: 'pinned',
    })
    expect(svc.get(child.id)).toMatchObject({ modelBinding: 'pinned', providerId: 'openai', modelId: 'gpt-x' })
  })

  it('update() writes modelBinding', () => {
    const conv = svc.create({ userId: 'user-1' })
    svc.update(conv.id, { modelBinding: 'auto' })
    expect(svc.get(conv.id)!.modelBinding).toBe('auto')
  })

  it('materializeBinding fixes the pair of a conversation that has none (positive)', () => {
    const conv = svc.create({ userId: 'user-1' })
    expect(svc.materializeBinding(conv.id, 'grok-cli', 'grok-cli-default')).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(svc.get(conv.id)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', modelBinding: 'pinned' })
  })

  it('a second materializeBinding with a different pair leaves the first, and returns it (negative)', () => {
    const conv = svc.create({ userId: 'user-1' })
    svc.materializeBinding(conv.id, 'grok-cli', 'grok-cli-default')
    expect(svc.materializeBinding(conv.id, 'claude-code', 'claude-code-sonnet')).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(svc.get(conv.id)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    // A conversation created with a pair is never overwritten either.
    const pinned = svc.create({ userId: 'user-1', providerId: 'openai', modelId: 'gpt-4o' })
    svc.materializeBinding(pinned.id, 'grok-cli', 'grok-cli-default')
    expect(svc.get(pinned.id)).toMatchObject({ providerId: 'openai', modelId: 'gpt-4o' })
  })
})
