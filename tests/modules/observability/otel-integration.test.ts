// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  createOtelService,
  ConsoleExporter,
  NoopExporter,
  SimpleSpanProcessor,
  AlwaysOnSampler,
  type SpanExporter,
} from '@modules/observability/otel/index'

/**
 * Phase-5 integration test: observability OTel wiring contract.
 *
 * Validates what the observability module's onStart relies on:
 *   - createOtelService produces a functioning tracer whose spans flow
 *     through the wired exporter
 *   - disabled (noop) mode is still safe to call from instrumentations
 *   - forceFlush / shutdown are idempotent for graceful teardown
 */

describe('OtelService integration', () => {
  it('tracer emits spans to the configured exporter when enabled', async () => {
    const received: string[] = []
    const exporter: SpanExporter = {
      export(spans: any[]) {
        for (const s of spans) received.push(s.name)
        // SpanExporter.export returns a Promise<ExportResult> — SimpleSpanProcessor
        // chains .catch() on it, so we cannot return a plain object.
        return Promise.resolve({ code: 'SUCCESS' as const })
      },
      async shutdown() { /* nothing to flush */ },
    } as const
    const otel = createOtelService({
      serviceName: 'eyas-test',
      enabled: true,
      exporter,
      // SimpleSpanProcessor flushes on every end() — deterministic for tests.
      // AlwaysOnSampler overrides the 10% default so the test's single span
      // is guaranteed to be recorded (the default would randomly drop it).
      processor: new SimpleSpanProcessor(exporter),
      sampler: new AlwaysOnSampler(),
    })

    const span = otel.tracer.startSpan('unit.work')
    span.end()
    await otel.forceFlush()

    expect(received).toContain('unit.work')
  })

  it('disabled mode: tracer still usable, no spans reach any exporter', async () => {
    const received: string[] = []
    const spyExporter: SpanExporter = {
      export(spans: any[]) {
        for (const s of spans) received.push(s.name)
        // SpanExporter.export returns a Promise<ExportResult> — SimpleSpanProcessor
        // chains .catch() on it, so we cannot return a plain object.
        return Promise.resolve({ code: 'SUCCESS' as const })
      },
      async shutdown() { /* nothing to flush */ },
    } as const
    // Disabled + explicit exporter → factory wraps with Noop internally
    const otel = createOtelService({
      serviceName: 'eyas-test',
      enabled: false,
      exporter: spyExporter,
    })

    const span = otel.tracer.startSpan('should.not.leak')
    span.end()
    await otel.forceFlush()

    expect(received).toHaveLength(0)
  })

  it('forceFlush and shutdown are safe to call and idempotent', async () => {
    const otel = createOtelService({
      serviceName: 'eyas-test',
      enabled: true,
      exporter: new NoopExporter(),
    })
    await expect(otel.forceFlush()).resolves.not.toThrow()
    await expect(otel.shutdown()).resolves.not.toThrow()
    // Second shutdown must not throw — important for onStop called twice
    // during test teardown races.
    await expect(otel.shutdown()).resolves.not.toThrow()
  })

  it('resource attributes carry service.name and optional extras', () => {
    const otel = createOtelService({
      serviceName: 'eyas-prod',
      serviceVersion: '1.2.3',
      enabled: false,
      exporter: new NoopExporter(),
      resourceAttributes: { 'deployment.environment': 'staging' },
    })
    expect(otel.resource.attributes['service.name']).toBe('eyas-prod')
    expect(otel.resource.attributes['service.version']).toBe('1.2.3')
    expect(otel.resource.attributes['deployment.environment']).toBe('staging')
  })

  it('spans carry a parent-child relationship when nested', async () => {
    const spans: any[] = []
    const exporter: SpanExporter = {
      export(batch: any[]) {
        spans.push(...batch)
        return Promise.resolve({ code: 'SUCCESS' as const })
      },
      async shutdown() { /* nothing to flush */ },
    } as const
    const otel = createOtelService({
      serviceName: 'eyas-test',
      enabled: true,
      exporter,
      processor: new SimpleSpanProcessor(exporter),
      sampler: new AlwaysOnSampler(),
    })

    const parent = otel.tracer.startSpan('parent')
    // startSpan takes a SpanContext (not a Span) as the parent option —
    // pulling `.context` off the parent span is the canonical pattern.
    const child = otel.tracer.startSpan('child', { parent: parent.context })
    child.end()
    parent.end()
    await otel.forceFlush()

    const parentSpan = spans.find(s => s.name === 'parent')
    const childSpan = spans.find(s => s.name === 'child')
    expect(parentSpan).toBeDefined()
    expect(childSpan).toBeDefined()
    // Both share the same trace id; child has parent's span id as its parent.
    // The EYAS TracerImpl exposes the SpanContext as `.context` (not
    // `.spanContext` as the OTel JS SDK does); we pin that shape here so a
    // future rename can't silently break downstream instrumentations.
    expect(childSpan.context.traceId).toBe(parentSpan.context.traceId)
    expect(childSpan.parentSpanId).toBe(parentSpan.context.spanId)
  })

  it('ConsoleExporter is usable (smoke) without throwing', async () => {
    const exporter = new ConsoleExporter()
    const otel = createOtelService({
      serviceName: 'eyas-test',
      enabled: true,
      exporter,
      processor: new SimpleSpanProcessor(exporter),
      sampler: new AlwaysOnSampler(),
    })
    const span = otel.tracer.startSpan('smoke')
    span.end()
    await expect(otel.forceFlush()).resolves.not.toThrow()
  })
})
