// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { TracerImpl } from '@modules/observability/otel/tracer'
import { AlwaysOnSampler } from '@modules/observability/otel/sampler'
import {
  instrumentAgentRun,
  instrumentToolCall,
  instrumentModelCall,
  honoOtelMiddleware,
  setHttpStatus,
} from '@modules/observability/otel/instrumentations'
import type {
  ReadableSpan,
  SpanProcessor,
} from '@modules/observability/otel/types'

function processor(): SpanProcessor & { ended: ReadableSpan[] } {
  const ended: ReadableSpan[] = []
  return {
    ended,
    onStart() {},
    onEnd(s) {
      ended.push(s)
    },
    async forceFlush() {},
    async shutdown() {},
  }
}

function mkTracer() {
  const proc = processor()
  const tracer = new TracerImpl({
    resource: { attributes: { 'service.name': 't' } },
    sampler: new AlwaysOnSampler(),
    scope: { name: 't' },
    processor: proc,
  })
  return { tracer, proc }
}

describe('instrumentAgentRun', () => {
  it('creates a span and sets agent attributes', async () => {
    const { tracer, proc } = mkTracer()
    const wrapped = instrumentAgentRun(tracer)(async (ctx, x: number) => x * 2)
    const out = await wrapped({ agentId: 'a1', agentName: 'Echo', sessionId: 's1', turn: 3 }, 21)
    expect(out).toBe(42)
    expect(proc.ended).toHaveLength(1)
    const s = proc.ended[0]!
    expect(s.name).toContain('agent.run')
    expect(s.attributes['eyas.agent.id']).toBe('a1')
    expect(s.attributes['eyas.agent.name']).toBe('Echo')
    expect(s.attributes['eyas.session.id']).toBe('s1')
    expect(s.attributes['eyas.turn']).toBe(3)
    expect(s.status.code).toBe('OK')
  })
})

describe('instrumentToolCall', () => {
  it('nests tool span as child of agent span', async () => {
    const { tracer, proc } = mkTracer()
    const tool = instrumentToolCall(tracer)(async (_ctx) => 'ok')
    const agent = instrumentAgentRun(tracer)(async () => {
      return tool({ toolName: 'echo', riskTier: 'safe' })
    })
    await agent({ agentId: 'a1' })
    expect(proc.ended).toHaveLength(2)
    const agentSpan = proc.ended.find((s) => s.name.includes('agent.run'))!
    const toolSpan = proc.ended.find((s) => s.name === 'tool.echo')!
    expect(toolSpan.context.traceId).toBe(agentSpan.context.traceId)
    expect(toolSpan.parentSpanId).toBe(agentSpan.context.spanId)
    expect(toolSpan.attributes['eyas.tool.name']).toBe('echo')
    expect(toolSpan.attributes['eyas.tool.risk_tier']).toBe('safe')
    expect(toolSpan.attributes['eyas.tool.result']).toBe('success')
  })

  it('records error on throw', async () => {
    const { tracer, proc } = mkTracer()
    const tool = instrumentToolCall(tracer)(async () => {
      throw new Error('nope')
    })
    await expect(tool({ toolName: 'broken' })).rejects.toThrow('nope')
    const s = proc.ended[0]!
    expect(s.status.code).toBe('ERROR')
    expect(s.attributes['eyas.tool.result']).toBe('error')
  })
})

describe('instrumentModelCall', () => {
  it('records usage reported via callback', async () => {
    const { tracer, proc } = mkTracer()
    const call = instrumentModelCall(tracer)(async (_ctx, report) => {
      report({ inputTokens: 100, outputTokens: 50, costUsd: 0.002 })
      return 'text'
    })
    const out = await call({ provider: 'anthropic', model: 'claude-opus-4', operation: 'chat' })
    expect(out).toBe('text')
    const s = proc.ended[0]!
    expect(s.name).toBe('model.chat anthropic/claude-opus-4')
    expect(s.attributes['eyas.model.provider']).toBe('anthropic')
    expect(s.attributes['eyas.model.name']).toBe('claude-opus-4')
    expect(s.attributes['eyas.model.usage.input_tokens']).toBe(100)
    expect(s.attributes['eyas.model.usage.output_tokens']).toBe(50)
    expect(s.attributes['eyas.model.usage.cost_usd']).toBe(0.002)
  })
})

describe('honoOtelMiddleware', () => {
  it('produces a SERVER span with http attributes and injects traceparent', async () => {
    const { tracer, proc } = mkTracer()
    const headerMap: Record<string, string> = {}
    const ctx = {
      req: {
        method: 'get',
        url: 'http://localhost/api/x',
        path: '/api/x',
        header: (_n: string) => undefined,
      },
      res: {
        headers: {
          set: (n: string, v: string) => {
            headerMap[n] = v
          },
        },
      },
    }
    const mw = honoOtelMiddleware(tracer)
    await mw(ctx, async () => { /* route handler */ })
    expect(proc.ended).toHaveLength(1)
    const s = proc.ended[0]!
    expect(s.kind).toBe('SERVER')
    expect(s.attributes['http.method']).toBe('GET')
    expect(s.attributes['http.route']).toBe('/api/x')
    // response has traceparent
    expect(headerMap['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('adopts an incoming traceparent as parent', async () => {
    const { tracer, proc } = mkTracer()
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const ctx = {
      req: {
        method: 'POST',
        url: 'http://localhost/x',
        path: '/x',
        header: (n: string) => (n === 'traceparent' ? incoming : undefined),
      },
      res: { headers: { set: () => {} } },
    }
    await honoOtelMiddleware(tracer)(ctx, async () => {})
    const s = proc.ended[0]!
    expect(s.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(s.parentSpanId).toBe('00f067aa0ba902b7')
  })
})

describe('setHttpStatus helper', () => {
  it('sets attribute and ERROR on 5xx', () => {
    const { tracer, proc } = mkTracer()
    const span = tracer.startSpan('h', { kind: 'SERVER' })
    setHttpStatus(span, 502)
    span.end()
    const s = proc.ended[0]!
    expect(s.attributes['http.status_code']).toBe(502)
    expect(s.status.code).toBe('ERROR')
  })

  it('no-ops on undefined', () => {
    expect(() => setHttpStatus(undefined, 200)).not.toThrow()
  })
})
