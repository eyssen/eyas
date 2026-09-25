// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J10 — OpenCode's memory bridge: the in-process session bindings (what an
// EYAS-created OpenCode session may read), and the flag-gated, project-scoped
// capture of its settled tool parts (a failed call marked as an error, a
// refused one left out) and of the terminal's output.
// No model-decided write exists any more.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { attachIngest, resetIngestBridge, type CapturePolicy } from '@modules/memory/v2/ingest-bridge'
import { RUN_CAPTURE_INPUT_MAX_CHARS } from '@modules/memory/v2/run-capture'
import * as bridge from '@modules/opencode/memory-bridge'
import {
  captureOpencodeToolEvent,
  capturePtyOutput,
  createSessionBindings,
  SESSION_BINDING_TTL_MS,
} from '@modules/opencode/memory-bridge'
import type { OpencodeEvent } from '@modules/opencode/types'

const ON: CapturePolicy = { toolResults: true, thinking: false }
const OFF: CapturePolicy = { toolResults: false, thinking: false }

let db: any
let enqueue: ReturnType<typeof vi.fn>
const units = () => enqueue.mock.calls.map((c) => c[0])

beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, type_id) VALUES ('P', 'T')`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id, agent_id) VALUES ('conv-p', 'P', 'u1', 'agent-1'), ('conv-free', NULL, 'u1', NULL), ('conv-other', 'P', 'u2', NULL)`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

function toolPart(status: string, over: Record<string, unknown> = {}, state: Record<string, unknown> = {}): OpencodeEvent {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'tool', callID: 'call_oc_0', tool: 'bash',
        state: { status, input: { command: 'ls' }, output: 'README.md\nsrc\n', title: 'ls', metadata: {}, time: { start: 1, end: 1_700_000_000_500 }, ...state },
        ...over,
      },
    },
  }
}

describe('session bindings', () => {
  it('(+) a plugin with the key the session was bound under gets the binding', () => {
    const sessions = createSessionBindings()
    sessions.bind('tok-1', 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-1' })
    const b = sessions.lookup('ses_1', { kind: 'plugin', tokenId: 'tok-1' })
    expect(b).toMatchObject({ tokenId: 'tok-1', sessionId: 'ses_1', conversationId: 'conv-p', userId: 'u1', turnId: 'turn-1' })
  })

  it('(+) a signed-in caller who is the bound user gets it too', () => {
    const sessions = createSessionBindings()
    sessions.bind('tok-1', 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    expect(sessions.lookup('ses_1', { kind: 'user', userId: 'u1' })?.conversationId).toBe('conv-p')
  })

  it('(−) another key, another user, an unknown or missing session get nothing', () => {
    const sessions = createSessionBindings()
    sessions.bind('tok-1', 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    expect(sessions.lookup('ses_1', { kind: 'plugin', tokenId: 'tok-2' })).toBeNull()
    expect(sessions.lookup('ses_1', { kind: 'plugin', tokenId: '' })).toBeNull()
    expect(sessions.lookup('ses_1', { kind: 'user', userId: 'u2' })).toBeNull()
    expect(sessions.lookup('ses_1', { kind: 'user', userId: '' })).toBeNull()
    expect(sessions.lookup('ses_9', { kind: 'plugin', tokenId: 'tok-1' })).toBeNull()
    expect(sessions.lookup(undefined, { kind: 'plugin', tokenId: 'tok-1' })).toBeNull()
  })

  it('(−) after unbind the lookup returns null', () => {
    const sessions = createSessionBindings()
    sessions.bind('tok-1', 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    sessions.unbind('ses_1')
    expect(sessions.lookup('ses_1', { kind: 'plugin', tokenId: 'tok-1' })).toBeNull()
    expect(sessions.size()).toBe(0)
  })

  it('(−) after the TTL the lookup returns null; a use starts the TTL over', () => {
    let t = 1_000
    const sessions = createSessionBindings({ now: () => t })
    sessions.bind('tok-1', 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    sessions.bind('tok-1', 'ses_2', { conversationId: 'conv-p', userId: 'u1' })
    t += SESSION_BINDING_TTL_MS - 1
    expect(sessions.lookup('ses_2', { kind: 'plugin', tokenId: 'tok-1' })).not.toBeNull()
    t += 2
    expect(sessions.lookup('ses_1', { kind: 'plugin', tokenId: 'tok-1' })).toBeNull()
    expect(sessions.lookup('ses_2', { kind: 'plugin', tokenId: 'tok-1' })).not.toBeNull()
    expect(sessions.size()).toBe(1)
  })

  it('(−) the retired model-decided write and the global query are gone', () => {
    expect(bridge).not.toHaveProperty('saveEyasMemory')
    expect(bridge).not.toHaveProperty('queryEyasMemory')
  })
})

describe('OpenCode tool capture', () => {
  function bound() {
    return createSessionBindings().bind('tok-1', 'ses_1', {
      conversationId: 'conv-p', userId: 'u1', runId: 'run-1', agentId: 'agent-x', model: 'anthropic/claude-x',
    })
  }

  it('(+) with the flag on, a completed tool part is captured once, in the conversation\'s project', () => {
    const binding = bound()
    expect(captureOpencodeToolEvent(toolPart('running'), binding, { db, policy: () => ON })).toBe(false)
    expect(captureOpencodeToolEvent(toolPart('completed'), binding, { db, policy: () => ON })).toBe(true)
    // OpenCode sends the settled part again: still one unit.
    expect(captureOpencodeToolEvent(toolPart('completed'), binding, { db, policy: () => ON })).toBe(false)
    expect(units()).toHaveLength(1)
    const [unit] = units()
    expect(unit).toMatchObject({
      sourceType: 'tool_result',
      actor: 'tool:bash',
      conversationId: 'conv-p',
      projectId: 'P',
      projectTypeId: 'T',
      trustTier: 'ingested',
      occurredAtMs: 1_700_000_000_500,
    })
    // The content is what the tool returned; the arguments are provenance only.
    expect(JSON.parse(unit.content)).toEqual({ tool: 'bash', output: 'README.md\nsrc\n', isError: false, outcome: 'success', executedBy: 'provider' })
    expect(unit.content).not.toContain('"command"')
    expect(unit.meta).toMatchObject({
      origin: 'opencode', entryPath: 'opencode', provider: 'opencode', model: 'anthropic/claude-x',
      agentId: 'agent-x', sessionId: 'run-1', opencodeSessionId: 'ses_1', toolUseId: 'call_oc_0', toolName: 'bash',
      input: { command: 'ls' },
    })
  })

  it('(+) another call of the same session is its own unit; long arguments are clipped', () => {
    const binding = bound()
    captureOpencodeToolEvent(toolPart('completed'), binding, { db, policy: () => ON })
    const long = 'x'.repeat(RUN_CAPTURE_INPUT_MAX_CHARS * 2)
    captureOpencodeToolEvent(toolPart('completed', { callID: 'call_oc_1', tool: 'read' }, { input: { filePath: long } }), binding, { db, policy: () => ON })
    expect(units()).toHaveLength(2)
    expect(typeof units()[1].meta.input).toBe('string')
    expect((units()[1].meta.input as string).length).toBeLessThanOrEqual(RUN_CAPTURE_INPUT_MAX_CHARS + 1)
  })

  it('(−) with the flag off, a completed tool part writes nothing', () => {
    expect(captureOpencodeToolEvent(toolPart('completed'), bound(), { db, policy: () => OFF })).toBe(false)
    expect(units()).toHaveLength(0)
  })

  it('(−) no binding means no capture', () => {
    expect(captureOpencodeToolEvent(toolPart('completed'), null, { db, policy: () => ON })).toBe(false)
    expect(captureOpencodeToolEvent(toolPart('completed'), undefined, { db, policy: () => ON })).toBe(false)
    expect(units()).toHaveLength(0)
  })

  it('(+) a call that ran and failed is recorded once, marked as an error, with its error text', () => {
    const binding = bound()
    const deps = { db, policy: () => ON }
    const failed = toolPart('error', { callID: 'call_fail' }, { output: undefined, error: 'Error: ENOENT: no such file or directory, open \'/w/missing.md\'' })
    expect(captureOpencodeToolEvent(failed, binding, deps)).toBe(true)
    expect(captureOpencodeToolEvent(failed, binding, deps)).toBe(false)
    expect(units()).toHaveLength(1)
    expect(JSON.parse(units()[0].content)).toEqual({
      tool: 'bash', output: 'Error: ENOENT: no such file or directory, open \'/w/missing.md\'', isError: true, outcome: 'error', executedBy: 'provider',
    })
    expect(units()[0]).toMatchObject({ sourceType: 'tool_result', trustTier: 'ingested', projectId: 'P' })
    expect(units()[0].meta).toMatchObject({ toolUseId: 'call_fail', input: { command: 'ls' } })
  })

  it('(−) a refused call ran nothing and leaves nothing: gate refusal, a rule, a dismissed question', () => {
    const binding = bound()
    const deps = { db, policy: () => ON }
    captureOpencodeToolEvent(toolPart('error', { callID: 'r1' }, { error: 'The user rejected permission to use this specific tool call.' }), binding, deps)
    captureOpencodeToolEvent(toolPart('error', { callID: 'r2' }, { error: 'The user rejected permission to use this specific tool call with the following feedback: no' }), binding, deps)
    captureOpencodeToolEvent(toolPart('error', { callID: 'r3' }, { error: 'The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules []' }), binding, deps)
    captureOpencodeToolEvent(toolPart('error', { callID: 'r4', tool: 'question' }, { error: 'The user dismissed this question' }), binding, deps)
    expect(units()).toHaveLength(0)
  })

  it('(−) with the flag off, a failed call writes nothing either', () => {
    expect(captureOpencodeToolEvent(toolPart('error', {}, { error: 'boom' }), bound(), { db, policy: () => OFF })).toBe(false)
    expect(units()).toHaveLength(0)
  })

  it('(−) empty output or error, running parts, text parts and other events are not tool results', () => {
    const binding = bound()
    const deps = { db, policy: () => ON }
    captureOpencodeToolEvent(toolPart('running', { callID: 'call_running' }), binding, deps)
    captureOpencodeToolEvent(toolPart('error', { callID: 'call_blank_error' }, { error: ' ' }), binding, deps)
    captureOpencodeToolEvent(toolPart('completed', { callID: 'call_empty' }, { output: '  ' }), binding, deps)
    captureOpencodeToolEvent({ type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 'ses_1', text: 'hi' } } }, binding, deps)
    captureOpencodeToolEvent({ type: 'message.updated', properties: { info: {} } }, binding, deps)
    captureOpencodeToolEvent({ type: 'message.part.updated' }, binding, deps)
    expect(units()).toHaveLength(0)
  })
})

describe('terminal capture', () => {
  const chunk = { sessionId: 'pty-1', userId: 'u1', conversationId: 'conv-p', text: '$ ls\nREADME.md\n', kind: 'tui' as const }

  it('(+) with the flag on, output of the user\'s own conversation is captured in its project', () => {
    expect(capturePtyOutput(chunk, { db, policy: () => ON, now: () => 42 })).toBe(true)
    expect(units()[0]).toMatchObject({
      sourceType: 'tool_result', actor: 'pty:tui', conversationId: 'conv-p', projectId: 'P', projectTypeId: 'T',
      trustTier: 'ingested', occurredAtMs: 42, content: '$ ls\nREADME.md\n',
      meta: { origin: 'terminal', provider: 'opencode', ptySessionId: 'pty-1', kind: 'tui' },
    })
    capturePtyOutput({ ...chunk, conversationId: 'conv-free', kind: 'shell' }, { db, policy: () => ON })
    expect(units()[1]).toMatchObject({ actor: 'pty:shell', projectId: null, meta: { provider: null } })
  })

  it('(−) with the flag off nothing is written', () => {
    expect(capturePtyOutput(chunk, { db, policy: () => OFF })).toBe(false)
    expect(units()).toHaveLength(0)
  })

  it('(−) no conversation, an unknown one, another user\'s one, or blank output: nothing', () => {
    const deps = { db, policy: () => ON }
    expect(capturePtyOutput({ ...chunk, conversationId: '' }, deps)).toBe(false)
    expect(capturePtyOutput({ ...chunk, conversationId: 'conv-nope' }, deps)).toBe(false)
    expect(capturePtyOutput({ ...chunk, conversationId: 'conv-other' }, deps)).toBe(false)
    expect(capturePtyOutput({ ...chunk, text: ' \n ' }, deps)).toBe(false)
    expect(units()).toHaveLength(0)
  })
})
