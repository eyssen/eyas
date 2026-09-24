// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createLocalBus } from '@core/bus/local-bus'
import { createMemoryDb } from '../../helpers/test-db'
import { wireHandoffRuns } from '@modules/agent/handoff-run'

/** wireHandoffRuns (I10): a hand-off event starts the colleague's home thread through the shared entry. */

let db: ReturnType<typeof createMemoryDb>
let bus: ReturnType<typeof createLocalBus>
let logger: any
let entry: ReturnType<typeof vi.fn>

const settle = () => new Promise((r) => setTimeout(r, 10))

function thread(id: string, status: string, agentId = 'engineer'): void {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, status, agent_id, goal_description, created_at, updated_at)
    VALUES (${id}, ${status}, ${agentId}, 'The brief', ${now}, ${now})`)
}

function handoff(conversationId: string, extra: Record<string, unknown> = {}): void {
  bus.emit('eyas.board.task_assigned', {
    conversationId, targetId: conversationId, agentId: 'engineer', handoffFromConversationId: 'parent-1', ...extra,
  })
}

beforeEach(() => {
  db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, status TEXT NOT NULL, agent_id TEXT, goal_description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  bus = createLocalBus()
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  entry = vi.fn(async () => ({ ran: true, sessionId: 'run-1' }))
})

describe('wireHandoffRuns', () => {
  it('(+) runs a waiting home thread through the shared entry', async () => {
    wireHandoffRuns({ bus, db, runConversation: () => entry, logger })
    thread('home-1', 'waiting')

    handoff('home-1')
    await settle()

    expect(entry).toHaveBeenCalledTimes(1)
    expect(entry).toHaveBeenCalledWith('home-1')
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'home-1', handoffFromConversationId: 'parent-1' }), expect.any(String))
  })

  it('(−) ignores a board task_assigned that is not a hand-off (the bot-executor owns those)', async () => {
    wireHandoffRuns({ bus, db, runConversation: () => entry, logger })
    thread('card-1', 'waiting')

    bus.emit('eyas.board.task_assigned', { conversationId: 'card-1', agentId: 'engineer' })
    await settle()

    expect(entry).not.toHaveBeenCalled()
  })

  it.each(['working', 'waiting_approval', 'idle'])('(−) does not start a run when the thread is %s', async (status) => {
    wireHandoffRuns({ bus, db, runConversation: () => entry, logger })
    thread('home-1', status)

    handoff('home-1')
    await settle()

    expect(entry).not.toHaveBeenCalled()
  })

  it('(−) does not start a run for a thread that belongs to another colleague, or does not exist', async () => {
    wireHandoffRuns({ bus, db, runConversation: () => entry, logger })
    thread('home-1', 'waiting', 'someone-else')

    handoff('home-1')
    handoff('missing')
    await settle()

    expect(entry).not.toHaveBeenCalled()
  })

  it('(−) a duplicate event while the run is in flight does not start a second run', async () => {
    let release!: () => void
    const slow = vi.fn(() => new Promise<{ ran: boolean }>((resolve) => { release = () => resolve({ ran: true }) }))
    wireHandoffRuns({ bus, db, runConversation: () => slow, logger })
    // The fake entry never flips the status, so only the in-flight guard stops the duplicate.
    thread('home-1', 'waiting')

    handoff('home-1')
    handoff('home-1')
    await settle()
    expect(slow).toHaveBeenCalledTimes(1)

    release()
    await settle()
  })

  it('(−) leaves the thread waiting and warns when the runner is not available', async () => {
    wireHandoffRuns({ bus, db, runConversation: () => undefined, logger })
    thread('home-1', 'waiting')

    handoff('home-1')
    await settle()

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'home-1' }), expect.stringMatching(/not available/))
  })

  it('(−) a run that did not start is logged with its reason; a throwing run is contained', async () => {
    const refused = vi.fn(async () => ({ ran: false, reason: 'over_budget' as const }))
    wireHandoffRuns({ bus, db, runConversation: () => refused, logger })
    thread('home-1', 'waiting')
    handoff('home-1')
    await settle()
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'over_budget' }), expect.any(String))

    const throwing = vi.fn(async () => { throw new Error('boom') })
    const bus2 = createLocalBus()
    wireHandoffRuns({ bus: bus2, db, runConversation: () => throwing, logger })
    bus2.emit('eyas.board.task_assigned', { conversationId: 'home-1', agentId: 'engineer', handoffFromConversationId: 'p' })
    await settle()
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'home-1' }), expect.any(String))
  })
})
