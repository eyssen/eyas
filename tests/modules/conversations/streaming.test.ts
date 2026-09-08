import { describe, it, expect } from 'vitest'
import { parseSSEBuffer } from '@shared/sse-parser'

describe('parseSSEBuffer', () => {
  it('parses a single complete SSE event', () => {
    const buffer = 'data: {"type":"text","text":"Hello"}\n\n'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(remaining).toBe('')
  })

  it('parses multiple complete SSE events', () => {
    const buffer =
      'data: {"type":"text","text":"Hello"}\n\n' +
      'data: {"type":"text","text":" world"}\n\n'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(events[1]).toEqual({ type: 'text', text: ' world' })
    expect(remaining).toBe('')
  })

  it('keeps incomplete data in the remaining buffer', () => {
    const buffer = 'data: {"type":"text","text":"Hello"}\n\ndata: {"type":"te'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(remaining).toBe('data: {"type":"te')
  })

  it('returns empty events for incomplete buffer with no double newline', () => {
    const buffer = 'data: {"type":"text","text":"partial"}'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(0)
    expect(remaining).toBe('data: {"type":"text","text":"partial"}')
  })

  it('handles empty buffer', () => {
    const [events, remaining] = parseSSEBuffer('')
    expect(events).toHaveLength(0)
    expect(remaining).toBe('')
  })

  it('skips non-data lines', () => {
    const buffer = 'event: message\ndata: {"type":"text","text":"Hello"}\n\n'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
  })

  it('skips malformed JSON gracefully', () => {
    const buffer =
      'data: {broken json}\n\n' +
      'data: {"type":"text","text":"valid"}\n\n'
    const [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'valid' })
    expect(remaining).toBe('')
  })

  it('parses done event with usage data', () => {
    const doneEvent = {
      type: 'done',
      message: { id: 1, role: 'assistant', content: 'Hello' },
      conversation: { tokensUsed: 150, status: 'idle' },
    }
    const buffer = `data: ${JSON.stringify(doneEvent)}\n\n`
    const [events] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(doneEvent)
  })

  it('parses tool_use event', () => {
    const buffer = 'data: {"type":"tool_use","name":"search","id":"tool_123"}\n\n'
    const [events] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'tool_use', name: 'search', id: 'tool_123' })
  })

  it('parses error event', () => {
    const buffer = 'data: {"type":"error","error":"Rate limit exceeded"}\n\n'
    const [events] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'error', error: 'Rate limit exceeded' })
  })

  it('handles sequential buffer accumulation correctly', () => {
    // Simulate chunked network delivery
    let buffer = ''

    // First chunk: partial event
    buffer += 'data: {"type":"text","text":"He'
    let [events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(0)
    buffer = remaining

    // Second chunk: completes the event + starts another
    buffer += 'llo"}\n\ndata: {"type":"text","text":"world"}\n\n'
    ;[events, remaining] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(events[1]).toEqual({ type: 'text', text: 'world' })
    expect(remaining).toBe('')
  })

  it('handles event stream with comments and blank lines', () => {
    // SSE spec allows comments (lines starting with :) and blank lines
    const buffer = ': keepalive\ndata: {"type":"text","text":"test"}\n\n'
    const [events] = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'test' })
  })

  it('handles a full conversation flow', () => {
    const buffer =
      'data: {"type":"text","text":"Hello"}\n\n' +
      'data: {"type":"text","text":" there"}\n\n' +
      'data: {"type":"tool_use","name":"search","id":"t1"}\n\n' +
      'data: {"type":"done","message":{"id":1,"role":"assistant","content":"Hello there"},"conversation":{"tokensUsed":100,"status":"idle"}}\n\n'

    // Typed generic: parseSSEBuffer<T> returns T[]. Shape is documented by the
    // test payload above — each event carries at least a `type` discriminator.
    const [events] = parseSSEBuffer<{ type: string }>(buffer)
    expect(events).toHaveLength(4)
    expect(events[0].type).toBe('text')
    expect(events[1].type).toBe('text')
    expect(events[2].type).toBe('tool_use')
    expect(events[3].type).toBe('done')
  })
})
