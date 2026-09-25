// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { resolveTeamContextImpl, resolveMemoryContextImpl, resolveConversationTagsImpl } from '../../../src/modules/prompt-wizard/context-resolvers.js'

describe('resolveTeamContextImpl', () => {
  it('returns null when no conversationId', async () => {
    expect(await resolveTeamContextImpl({}, null)).toBeNull()
  })

  it('maps the newest running session to a TeamContextSummary', async () => {
    const ctx: any = {
      agents: {
        teamSessions: {
          listByConversation: () => [
            { id: 'ts1', status: 'running', config: JSON.stringify({ phases: [{ agents: ['a1', 'a2'] }, { agents: ['a2'] }] }) },
          ],
          readMemory: () => [{ id: 'm1' }, { id: 'm2' }],
        },
        registry: { get: (id: string) => ({ name: id.toUpperCase(), tier: 'team' }) },
      },
    }
    const out = await resolveTeamContextImpl(ctx, 'conv-1')
    expect(out).toEqual({
      teamSessionId: 'ts1',
      members: [
        { name: 'A1', tier: 'team', status: 'running' },
        { name: 'A2', tier: 'team', status: 'running' },
      ],
      sharedMemoryEntryCount: 2,
    })
  })

  it('never throws on malformed config; falls back to an empty member list', async () => {
    const ctx: any = { agents: { teamSessions: { listByConversation: () => [{ id: 'ts', status: 'running', config: '{not json' }], readMemory: () => [] }, registry: { get: () => null } } }
    const out = await resolveTeamContextImpl(ctx, 'c')
    expect(out).toEqual({ teamSessionId: 'ts', members: [], sharedMemoryEntryCount: 0 })
  })
})

describe('resolveMemoryContextImpl', () => {
  it('collects agent-scoped working memory and goal ancestry', async () => {
    const ctx: any = {
      memory: { working: { listByPrefix: (p: string) => (p === 'a1:' ? [{ content: 'pref X' }] : []) } },
      conversations: { getAncestry: () => [{ title: 'Root', goalDescription: 'ship it' }, { title: 'Child', goalDescription: null }] },
    }
    const out = await resolveMemoryContextImpl(ctx, 'conv-1', 'a1')
    expect(out).toEqual({ workingMemory: [{ content: 'pref X' }], goalAncestry: '[Root] ship it' })
  })

  it('returns null when nothing is available', async () => {
    const ctx: any = { memory: { working: { listByPrefix: () => [] } }, conversations: { getAncestry: () => [] } }
    expect(await resolveMemoryContextImpl(ctx, 'conv-1', 'a1')).toBeNull()
  })

  it('never leaks other agents memory when agentId is empty (no listAll)', async () => {
    const ctx: any = {
      memory: { working: { listByPrefix: () => [], listAll: () => [{ content: 'SOMEONE ELSE secret' }] } },
      conversations: { getAncestry: () => [] },
    }
    expect(await resolveMemoryContextImpl(ctx, 'conv-1', '')).toBeNull()
  })
})

describe('resolveConversationTagsImpl', () => {
  it('returns null when no conversationId', async () => {
    expect(await resolveConversationTagsImpl({}, null)).toBeNull()
  })

  it('returns null when the conversation has no tags', async () => {
    const ctx: any = { board: { tags: { getConversationTags: () => [] } } }
    expect(await resolveConversationTagsImpl(ctx, 'conv-1')).toBeNull()
  })

  it('maps category + name for the suffix line', async () => {
    const ctx: any = {
      board: {
        tags: {
          getConversationTags: () => [
            { name: 'bravo', categoryName: 'module' },
            { name: 'alpha', categoryName: 'area' },
          ],
        },
      },
    }
    expect(await resolveConversationTagsImpl(ctx, 'conv-1')).toEqual([
      { name: 'bravo', categoryName: 'module' },
      { name: 'alpha', categoryName: 'area' },
    ])
  })

  it('never throws when the board module is missing', async () => {
    expect(await resolveConversationTagsImpl({}, 'conv-1')).toBeNull()
  })
})
