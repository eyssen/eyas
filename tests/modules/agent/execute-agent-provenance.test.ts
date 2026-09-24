// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// W8 — the task executeAgent stores as the child conversation's user message
// was written by an agent (delegation, pipeline) or by an A2A peer, never by
// the owner; memory trust follows that author.

import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextRun: () => AsyncGenerator<any>

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({ run: () => nextRun() }),
}))

import { agentModule } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function boot() {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  ctx.conversations = { get: vi.fn().mockReturnValue(null), addMessage: vi.fn() }
  return ctx
}

describe('executeAgent — message provenance', () => {
  beforeEach(() => {
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'done it' }
      yield { type: 'done', response: { content: [{ type: 'text', text: 'done it' }] } }
    })()
  })

  it('a delegated task is agent-authored, and the answer carries the same entry path', async () => {
    const ctx = await boot()
    await ctx.agents.executeAgent('conv-d', 'researcher', 'find the bug')
    const calls = ctx.conversations.addMessage.mock.calls
    expect(calls[0]).toEqual(['conv-d', expect.objectContaining({ role: 'user', content: 'find the bug', author: 'agent', entryPath: 'delegation' })])
    expect(calls[1]).toEqual(['conv-d', expect.objectContaining({ role: 'assistant', entryPath: 'delegation' })])
  })

  it('a pipeline stage keeps its own entry path', async () => {
    const ctx = await boot()
    await ctx.agents.executeAgent('conv-p', 'researcher', 'implement the ticket', { origin: 'pipeline' })
    expect(ctx.conversations.addMessage.mock.calls[0][1]).toMatchObject({ author: 'agent', entryPath: 'pipeline' })
  })

  it('an A2A task is a peer\'s, never the owner\'s', async () => {
    const ctx = await boot()
    await ctx.agents.executeAgent('conv-a', 'researcher', 'summarise your catalogue', { origin: 'delegation', audience: 'external' })
    const first = ctx.conversations.addMessage.mock.calls[0][1]
    expect(first).toMatchObject({ author: 'peer', entryPath: 'a2a' })
    expect(first.author).not.toBe('owner')
  })
})
