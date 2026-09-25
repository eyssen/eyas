// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseAcpSessionUpdate } from '@modules/model/submodules/grok-cli/acp-events.js'

describe('parseAcpSessionUpdate', () => {
  it('parses a tool_call with rawInput and locations', () => {
    const result = parseAcpSessionUpdate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_1',
        title: 'Reading notes.md',
        kind: 'read',
        status: 'pending',
        rawInput: { path: '/w/notes.md' },
        locations: [{ path: '/w/notes.md', line: 3 }],
      },
    })
    expect(result).toEqual({
      ok: true,
      sessionId: 's1',
      event: {
        kind: 'tool_call',
        toolCallId: 'call_1',
        title: 'Reading notes.md',
        toolKind: 'read',
        status: 'pending',
        rawInput: { path: '/w/notes.md' },
        locations: [{ path: '/w/notes.md', line: 3 }],
      },
    })
  })

  it('parses a tool_call_update with content and rawOutput', () => {
    const result = parseAcpSessionUpdate({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'hello' } }],
        rawOutput: { bytes: 5 },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event).toEqual({
      kind: 'tool_call_update',
      toolCallId: 'call_1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'hello' } }],
      rawOutput: { bytes: 5 },
    })
  })

  it('parses message and thought chunks and plans', () => {
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } } }))
      .toEqual({ ok: true, event: { kind: 'agent_message_chunk', text: 'Hi' } })
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } } }))
      .toEqual({ ok: true, event: { kind: 'agent_thought_chunk', text: 'hmm' } })
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'xx' } } }))
      .toEqual({ ok: true, event: { kind: 'agent_message_chunk', text: '' } })
    const plan = parseAcpSessionUpdate({ update: { sessionUpdate: 'plan', entries: [{ content: 'step 1', status: 'pending', priority: 'high' }] } })
    expect(plan.ok && plan.event.kind === 'plan' && plan.event.entries[0].content).toBe('step 1')
  })

  it('reports a malformed update as ok:false without throwing', () => {
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'tool_call', title: 'no id' } }).ok).toBe(false)
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'tool_call', toolCallId: 'c', status: 'exploded' } }).ok).toBe(false)
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'plan', entries: 'nope' } }).ok).toBe(false)
    expect(parseAcpSessionUpdate({}).ok).toBe(false)
    expect(parseAcpSessionUpdate(null).ok).toBe(false)
    expect(parseAcpSessionUpdate('garbage').ok).toBe(false)
    const hostile = { get update() { throw new Error('boom') } }
    expect(() => parseAcpSessionUpdate(hostile)).not.toThrow()
    expect(parseAcpSessionUpdate(hostile).ok).toBe(false)
  })

  it("passes an unknown sessionUpdate through as kind 'other'", () => {
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'available_commands_update', availableCommands: [] } }))
      .toEqual({ ok: true, event: { kind: 'other', sessionUpdate: 'available_commands_update' } })
  })
})
