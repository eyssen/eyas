// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from '@modules/observability/otel/span-processor'
import type {
  ExportResult,
  ReadableSpan,
  SpanExporter,
} from '@modules/observability/otel/types'

function fakeSpan(sampled = true): ReadableSpan {
  return {
    name: 'x',
    kind: 'INTERNAL',
    context: {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      traceFlags: sampled ? 0x01 : 0x00,
    },
    startTimeUnixNano: 0n,
    endTimeUnixNano: 1_000n,
    attributes: {},
    events: [],
    status: { code: 'UNSET' },
    resource: { attributes: {} },
    instrumentationScope: { name: 'test' },
  }
}

class CollectingExporter implements SpanExporter {
  public batches: ReadableSpan[][] = []
  public shutdownCalled = false
  async export(spans: ReadableSpan[]): Promise<ExportResult> {
    this.batches.push([...spans])
    return { code: 'SUCCESS' }
  }
  async shutdown(): Promise<void> {
    this.shutdownCalled = true
  }
}

describe('BatchSpanProcessor', () => {
  it('buffers up to maxExportBatchSize then flushes', async () => {
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, {
      scheduledDelayMs: 60_000, // disable time-based flush
      maxExportBatchSize: 3,
      maxQueueSize: 100,
    })
    for (let i = 0; i < 3; i++) p.onEnd(fakeSpan())
    // Let microtasks run
    await new Promise((r) => setTimeout(r, 5))
    expect(exp.batches).toHaveLength(1)
    expect(exp.batches[0]).toHaveLength(3)
    await p.shutdown()
  })

  it('skips non-sampled spans', () => {
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, { scheduledDelayMs: 60_000 })
    for (let i = 0; i < 5; i++) p.onEnd(fakeSpan(false))
    expect(p.queueSize).toBe(0)
    void p.shutdown()
  })

  it('forceFlush drains the queue', async () => {
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, {
      scheduledDelayMs: 60_000,
      maxExportBatchSize: 128,
    })
    for (let i = 0; i < 5; i++) p.onEnd(fakeSpan())
    expect(p.queueSize).toBe(5)
    await p.forceFlush()
    expect(p.queueSize).toBe(0)
    expect(exp.batches.flat()).toHaveLength(5)
  })

  it('shutdown flushes and calls exporter.shutdown', async () => {
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, { scheduledDelayMs: 60_000 })
    p.onEnd(fakeSpan())
    await p.shutdown()
    expect(exp.batches.flat()).toHaveLength(1)
    expect(exp.shutdownCalled).toBe(true)
  })

  it('drops oldest when queue overflows and dropOnOverflow=true', async () => {
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, {
      scheduledDelayMs: 60_000,
      maxExportBatchSize: 1000,
      maxQueueSize: 3,
      dropOnOverflow: true,
    })
    for (let i = 0; i < 5; i++) p.onEnd(fakeSpan())
    // Queue must stay at 3 — each onEnd when full shifts one out then pushes.
    expect(p.queueSize).toBeLessThanOrEqual(3)
    await p.shutdown()
  })

  it('interval triggers flush', async () => {
    vi.useFakeTimers()
    const exp = new CollectingExporter()
    const p = new BatchSpanProcessor(exp, {
      scheduledDelayMs: 100,
      maxExportBatchSize: 1000,
    })
    p.onEnd(fakeSpan())
    expect(exp.batches).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(150)
    // Allow microtasks
    await Promise.resolve()
    expect(exp.batches.flat()).toHaveLength(1)
    vi.useRealTimers()
    await p.shutdown()
  })
})

describe('SimpleSpanProcessor', () => {
  it('exports immediately', async () => {
    const exp = new CollectingExporter()
    const p = new SimpleSpanProcessor(exp)
    p.onEnd(fakeSpan())
    await new Promise((r) => setTimeout(r, 5))
    expect(exp.batches).toHaveLength(1)
    await p.shutdown()
    expect(exp.shutdownCalled).toBe(true)
  })
})
