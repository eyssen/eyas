// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { OtlpHttpExporter } from '@modules/observability/otel/exporter/otlp-http'
import { ConsoleExporter } from '@modules/observability/otel/exporter/console'
import { NoopExporter } from '@modules/observability/otel/exporter/noop'
import type { ReadableSpan } from '@modules/observability/otel/types'

function mkSpan(name = 's', parent?: string): ReadableSpan {
  return {
    name,
    kind: 'INTERNAL',
    context: {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: '1111111111111111',
      traceFlags: 0x01,
    },
    parentSpanId: parent,
    startTimeUnixNano: 1_000_000n,
    endTimeUnixNano: 2_000_000n,
    attributes: { foo: 'bar', n: 42, b: true, arr: ['x', 'y'] },
    events: [{ name: 'e', timeUnixNano: 1_500_000n, attributes: { k: 'v' } }],
    status: { code: 'OK' },
    resource: { attributes: { 'service.name': 'svc' } },
    instrumentationScope: { name: 'test' },
  }
}

describe('OtlpHttpExporter - wire format', () => {
  it('produces valid OTLP JSON shape', async () => {
    const seen: { url: string; body: string; headers: Record<string, string> }[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        body: init!.body as string,
        headers: init!.headers as Record<string, string>,
      })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const exp = new OtlpHttpExporter({
      endpoint: 'http://collector:4318/v1/traces',
      headers: { 'x-api-key': 'test' },
      fetchImpl,
    })

    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('SUCCESS')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('http://collector:4318/v1/traces')
    expect(seen[0]!.headers['x-api-key']).toBe('test')

    const payload = JSON.parse(seen[0]!.body)
    expect(payload.resourceSpans).toBeDefined()
    expect(payload.resourceSpans).toHaveLength(1)
    const rs = payload.resourceSpans[0]
    expect(rs.resource.attributes).toEqual(
      expect.arrayContaining([{ key: 'service.name', value: { stringValue: 'svc' } }]),
    )
    const s = rs.scopeSpans[0].spans[0]
    expect(s.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(s.spanId).toBe('1111111111111111')
    // int is string-encoded per OTLP JSON spec
    expect(s.startTimeUnixNano).toBe('1000000')
    expect(s.endTimeUnixNano).toBe('2000000')
    expect(s.kind).toBe(1) // INTERNAL
    expect(s.status.code).toBe(1) // OK
    // attribute encoding
    const attrMap = new Map(s.attributes.map((kv: any) => [kv.key, kv.value]))
    expect(attrMap.get('foo')).toEqual({ stringValue: 'bar' })
    expect(attrMap.get('n')).toEqual({ intValue: '42' })
    expect(attrMap.get('b')).toEqual({ boolValue: true })
    // events
    expect(s.events[0].name).toBe('e')
    expect(s.events[0].timeUnixNano).toBe('1500000')
  })

  it('retries on 500 then succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls < 3) return new Response('x', { status: 500 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const exp = new OtlpHttpExporter({
      fetchImpl,
      maxRetries: 3,
      backoffBaseMs: 1,
    })
    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('SUCCESS')
    expect(calls).toBe(3)
  })

  it('drops after exhausting retries on persistent 500', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return new Response('x', { status: 500 })
    }) as unknown as typeof fetch

    const exp = new OtlpHttpExporter({
      fetchImpl,
      maxRetries: 2,
      backoffBaseMs: 1,
    })
    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('FAILED')
    // 1 initial + 2 retries = 3
    expect(calls).toBe(3)
  })

  it('does not retry on 400', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return new Response('bad', { status: 400 })
    }) as unknown as typeof fetch

    const exp = new OtlpHttpExporter({ fetchImpl, maxRetries: 3, backoffBaseMs: 1 })
    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('FAILED')
    expect(calls).toBe(1)
  })

  it('shutdown blocks further exports', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const exp = new OtlpHttpExporter({ fetchImpl })
    await exp.shutdown()
    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('FAILED')
  })

  it('returns SUCCESS on empty input', async () => {
    const exp = new OtlpHttpExporter()
    const res = await exp.export([])
    expect(res.code).toBe('SUCCESS')
  })
})

describe('ConsoleExporter', () => {
  it('writes one JSON line per span', async () => {
    const lines: string[] = []
    const exp = new ConsoleExporter({ write: (l) => lines.push(l) })
    await exp.export([mkSpan('a'), mkSpan('b')])
    expect(lines).toHaveLength(2)
    const obj = JSON.parse(lines[0]!)
    expect(obj.type).toBe('otel.span')
    expect(obj.name).toBe('a')
    expect(obj.durationMs).toBe(1) // (2_000_000 - 1_000_000) / 1_000_000 = 1
  })
})

describe('NoopExporter', () => {
  it('returns SUCCESS silently', async () => {
    const exp = new NoopExporter()
    const res = await exp.export([mkSpan()])
    expect(res.code).toBe('SUCCESS')
  })
})
