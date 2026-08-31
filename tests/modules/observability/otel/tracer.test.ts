// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { TracerImpl } from '@modules/observability/otel/tracer'
import { AlwaysOnSampler, AlwaysOffSampler } from '@modules/observability/otel/sampler'
import type {
  ReadableSpan,
  SpanProcessor,
  Resource,
  Attributes,
} from '@modules/observability/otel/types'

function captureProcessor(): SpanProcessor & { ended: ReadableSpan[] } {
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

const resource: Resource = { attributes: { 'service.name': 'test' } }

describe('TracerImpl.startSpan', () => {
  let proc: ReturnType<typeof captureProcessor>
  let tracer: TracerImpl

  beforeEach(() => {
    proc = captureProcessor()
    tracer = new TracerImpl({
      resource,
      sampler: new AlwaysOnSampler(),
      scope: { name: 'test' },
      processor: proc,
    })
  })

  it('produces a root span with 16-byte trace id and 8-byte span id', () => {
    const span = tracer.startSpan('root')
    expect(span.context.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(span.context.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span.context.traceFlags).toBe(0x01)
    span.end()
    expect(proc.ended).toHaveLength(1)
  })

  it('propagates setAttribute and setAttributes', () => {
    const span = tracer.startSpan('x')
    span.setAttribute('a', 1)
    span.setAttributes({ b: 'two', c: true })
    span.end()
    const attrs = proc.ended[0]!.attributes as Attributes
    expect(attrs['a']).toBe(1)
    expect(attrs['b']).toBe('two')
    expect(attrs['c']).toBe(true)
  })

  it('records exceptions as events with semantic attribute names', () => {
    const span = tracer.startSpan('x')
    span.recordException(new TypeError('boom'))
    span.end()
    const ev = proc.ended[0]!.events[0]!
    expect(ev.name).toBe('exception')
    expect(ev.attributes?.['exception.type']).toBe('TypeError')
    expect(ev.attributes?.['exception.message']).toBe('boom')
  })

  it('ignores writes after end()', () => {
    const span = tracer.startSpan('x')
    span.end()
    span.setAttribute('late', 1)
    expect(proc.ended[0]!.attributes['late']).toBeUndefined()
  })

  it('does not emit spans when sampler drops', () => {
    const off = new TracerImpl({
      resource,
      sampler: new AlwaysOffSampler(),
      scope: { name: 'test' },
      processor: proc,
    })
    const span = off.startSpan('dropped')
    span.setAttribute('k', 1)
    span.end()
    expect(proc.ended).toHaveLength(0)
    expect(span.isRecording()).toBe(false)
  })
})

describe('TracerImpl.startActiveSpan parent/child', () => {
  it('nested spans share trace id and set parentSpanId', async () => {
    const proc = captureProcessor()
    const tracer = new TracerImpl({
      resource,
      sampler: new AlwaysOnSampler(),
      scope: { name: 'test' },
      processor: proc,
    })

    await tracer.startActiveSpan('parent', undefined, async (parent) => {
      await tracer.startActiveSpan('child', undefined, async (child) => {
        expect(child.context.traceId).toBe(parent.context.traceId)
        expect(child.context.spanId).not.toBe(parent.context.spanId)
      })
    })

    expect(proc.ended).toHaveLength(2)
    const childSpan = proc.ended.find((s) => s.name === 'child')!
    const parentSpan = proc.ended.find((s) => s.name === 'parent')!
    expect(childSpan.parentSpanId).toBe(parentSpan.context.spanId)
    expect(childSpan.context.traceId).toBe(parentSpan.context.traceId)
  })

  it('records exception and ERROR status when wrapped fn throws', async () => {
    const proc = captureProcessor()
    const tracer = new TracerImpl({
      resource,
      sampler: new AlwaysOnSampler(),
      scope: { name: 'test' },
      processor: proc,
    })
    await expect(
      tracer.startActiveSpan('err', undefined, async () => {
        throw new Error('kaboom')
      }),
    ).rejects.toThrow('kaboom')

    expect(proc.ended).toHaveLength(1)
    expect(proc.ended[0]!.status.code).toBe('ERROR')
    expect(proc.ended[0]!.events[0]!.attributes?.['exception.message']).toBe('kaboom')
  })

  it('accepts synchronous callbacks', () => {
    const proc = captureProcessor()
    const tracer = new TracerImpl({
      resource,
      sampler: new AlwaysOnSampler(),
      scope: { name: 'test' },
      processor: proc,
    })
    const out = tracer.startActiveSpan('sync', undefined, () => 42)
    expect(out).toBe(42)
    expect(proc.ended).toHaveLength(1)
  })
})
