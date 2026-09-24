// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  parseTraceparent,
  formatTraceparent,
  getActiveSpan,
  withActiveSpanAsync,
  generateTraceId,
  generateSpanId,
} from '@modules/observability/otel/context'
import { TracerImpl } from '@modules/observability/otel/tracer'
import { AlwaysOnSampler } from '@modules/observability/otel/sampler'

describe('W3C traceparent parsing', () => {
  it('parses a valid header', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const ctx = parseTraceparent(header)
    expect(ctx).not.toBeNull()
    expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(ctx!.spanId).toBe('00f067aa0ba902b7')
    expect(ctx!.traceFlags).toBe(1)
    expect(ctx!.isRemote).toBe(true)
  })

  it('round-trips format -> parse', () => {
    const ctx = {
      traceId: generateTraceId(),
      spanId: generateSpanId(),
      traceFlags: 1,
    }
    const header = formatTraceparent(ctx)
    const parsed = parseTraceparent(header)
    expect(parsed?.traceId).toBe(ctx.traceId)
    expect(parsed?.spanId).toBe(ctx.spanId)
  })

  it('rejects malformed headers and invalid ids', () => {
    expect(parseTraceparent(null)).toBeNull()
    expect(parseTraceparent('')).toBeNull()
    expect(parseTraceparent('00-xyz-abc-01')).toBeNull()
    // ff version is invalid per spec
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
    // all-zero trace id is invalid
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull()
  })
})

describe('ID generators', () => {
  it('generates hex of correct length', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is highly unique across many calls', () => {
    const s = new Set<string>()
    for (let i = 0; i < 1000; i++) s.add(generateTraceId())
    expect(s.size).toBe(1000)
  })
})

describe('AsyncLocalStorage-based active span', () => {
  it('propagates span through awaited chains', async () => {
    const tracer = new TracerImpl({
      resource: { attributes: { 'service.name': 't' } },
      sampler: new AlwaysOnSampler(),
      scope: { name: 't' },
    })
    const span = tracer.startSpan('root')
    await withActiveSpanAsync(span, async () => {
      expect(getActiveSpan()).toBe(span)
      await new Promise((r) => setTimeout(r, 1))
      expect(getActiveSpan()).toBe(span)
    })
    // Outside: no span
    expect(getActiveSpan()).toBeUndefined()
    span.end()
  })
})
