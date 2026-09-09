// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createAgentMessaging } from '@modules/agent/agent-messaging'
import { createAgentMessagingTools } from '@modules/tools/builtin/agent-messaging-tools'

/**
 * Contract test: the agent messaging tools against the REAL messaging
 * service. These tools depend on `ToolContext.sessionId`, which the agent
 * runner threads in (R7, Task 5) — this file pins the tool side of that
 * seam: with a sessionId the round trip works, without one both tools fail
 * soft instead of writing rows under a bogus session.
 */

const testDb = createTestDb('agent-messaging-tools-contract')
let db: ReturnType<typeof testDb.open>
let messaging: ReturnType<typeof createAgentMessaging>
let harness: ToolContractHarness

beforeEach(() => {
  db = testDb.open()
  messaging = createAgentMessaging(db)
  harness = createToolContractHarness(createAgentMessagingTools(messaging))
})

afterEach(() => testDb.cleanup())

describe('agent messaging tools ↔ messaging service contract', () => {
  it('a directed message written by agent-a is readable by agent-b', async () => {
    const sent = await harness.run(
      'send_agent_message',
      { toAgent: 'agent-b', content: 'The FTS index is missing the trigger' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )

    expect(sent.success).toBe(true)
    const sentOut = sent.output as any
    expect(sentOut.error).toBeUndefined()
    expect(sentOut.sent).toBe(true)

    const read = await harness.run('read_agent_messages', {}, { sessionId: 'run-1', agentId: 'agent-b' })
    const messages = (read.output as any).messages
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain('FTS index')
    expect(messages[0].fromAgent).toBe('agent-a')
    expect(messages[0].toAgent).toBe('agent-b')
  })

  it('a directed message is not visible to an unrelated agent', async () => {
    await harness.run(
      'send_agent_message',
      { toAgent: 'agent-b', content: 'for b only' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )

    const read = await harness.run('read_agent_messages', {}, { sessionId: 'run-1', agentId: 'agent-c' })

    expect((read.output as any).messages).toHaveLength(0)
  })

  it('broadcast is visible to every agent in the session', async () => {
    await harness.run(
      'send_agent_message',
      { toAgent: 'broadcast', content: 'Switching to the OCA reconcile module' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )

    for (const agentId of ['agent-b', 'agent-c']) {
      const read = await harness.run('read_agent_messages', {}, { sessionId: 'run-1', agentId })
      const messages = (read.output as any).messages
      expect(messages).toHaveLength(1)
      expect(messages[0].toAgent).toBeNull()
    }
  })

  it('messages stay inside their own session', async () => {
    await harness.run(
      'send_agent_message',
      { toAgent: 'broadcast', content: 'session one only' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )

    const read = await harness.run('read_agent_messages', {}, { sessionId: 'run-2', agentId: 'agent-b' })

    expect((read.output as any).messages).toHaveLength(0)
  })

  it('sinceId filters out already-seen messages', async () => {
    const first = await harness.run(
      'send_agent_message',
      { toAgent: 'agent-b', content: 'first' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )
    await harness.run(
      'send_agent_message',
      { toAgent: 'agent-b', content: 'second' },
      { sessionId: 'run-1', agentId: 'agent-a' },
    )

    const read = await harness.run(
      'read_agent_messages',
      { sinceId: (first.output as any).messageId },
      { sessionId: 'run-1', agentId: 'agent-b' },
    )

    const messages = (read.output as any).messages
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('second')
  })

  it('fails soft outside a supervised agent run (no sessionId on the context)', async () => {
    const sent = await harness.run('send_agent_message', { toAgent: 'agent-b', content: 'orphan' })
    expect(sent.success).toBe(true)
    expect((sent.output as any).error).toMatch(/no active session/i)
    expect((sent.output as any).sent).toBeUndefined()

    const read = await harness.run('read_agent_messages', {})
    expect(read.success).toBe(true)
    expect((read.output as any).messages).toEqual([])

    expect(messaging.getAll('run-1')).toHaveLength(0)
  })
})
