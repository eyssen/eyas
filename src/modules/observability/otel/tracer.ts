// Part of eYssen. See LICENSE file for full copyright and licensing details.

import {
  generateSpanId,
  generateTraceId,
  getActiveSpan,
  withActiveSpan,
  withActiveSpanAsync,
} from './context.js'
import type {
  AttributeValue,
  Attributes,
  InstrumentationScope,
  ReadableSpan,
  Resource,
  Sampler,
  Span,
  SpanContext,
  SpanEvent,
  SpanKind,
  SpanProcessor,
  SpanStatus,
  StartSpanOptions,
  Tracer,
} from './types.js'

function nowNs(): bigint {
  // Millisecond precision converted to ns is sufficient for our needs.
  return BigInt(Date.now()) * 1_000_000n
}

/**
 * Internal mutable span implementation. Backs both the Span public API and
 * the ReadableSpan snapshot passed to processors.
 */
class SpanImpl implements Span, ReadableSpan {
  name: string
  kind: SpanKind
  context: SpanContext
  parentSpanId?: string
  startTimeUnixNano: bigint
  endTimeUnixNano?: bigint
  attributes: Attributes
  events: SpanEvent[] = []
  status: SpanStatus = { code: 'UNSET' }
  resource: Resource
  instrumentationScope: InstrumentationScope
  private readonly processor?: SpanProcessor
  private readonly recording: boolean
  private ended = false

  constructor(opts: {
    name: string
    kind: SpanKind
    context: SpanContext
    parentSpanId?: string
    startTime: bigint
    attributes: Attributes
    resource: Resource
    scope: InstrumentationScope
    processor?: SpanProcessor
    recording: boolean
  }) {
    this.name = opts.name
    this.kind = opts.kind
    this.context = opts.context
    this.parentSpanId = opts.parentSpanId
    this.startTimeUnixNano = opts.startTime
    this.attributes = { ...opts.attributes }
    this.resource = opts.resource
    this.instrumentationScope = opts.scope
    this.processor = opts.processor
    this.recording = opts.recording
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (!this.recording || this.ended) return this
    this.attributes[key] = value
    return this
  }

  setAttributes(attrs: Attributes): this {
    if (!this.recording || this.ended) return this
    for (const k of Object.keys(attrs)) this.attributes[k] = attrs[k]!
    return this
  }

  addEvent(name: string, attributes?: Attributes): this {
    if (!this.recording || this.ended) return this
    this.events.push({ name, timeUnixNano: nowNs(), attributes })
    return this
  }

  recordException(error: Error | unknown): this {
    if (!this.recording || this.ended) return this
    const err = error instanceof Error ? error : new Error(String(error))
    const attrs: Attributes = {
      'exception.type': err.name || 'Error',
      'exception.message': err.message || String(err),
    }
    if (err.stack) attrs['exception.stacktrace'] = err.stack
    this.events.push({
      name: 'exception',
      timeUnixNano: nowNs(),
      attributes: attrs,
    })
    return this
  }

  setStatus(status: SpanStatus): this {
    if (!this.recording || this.ended) return this
    this.status = { ...status }
    return this
  }

  updateName(name: string): this {
    if (!this.recording || this.ended) return this
    this.name = name
    return this
  }

  end(endTime?: bigint): void {
    if (this.ended) return
    this.ended = true
    this.endTimeUnixNano = endTime ?? nowNs()
    if (this.recording) this.processor?.onEnd(this)
  }

  isRecording(): boolean {
    return this.recording && !this.ended
  }
}

/**
 * Non-recording span: implements the Span interface but is a pure no-op.
 * Used when the sampler returns DROP so user code still has a span to call
 * methods on without branches.
 */
class NoopSpan implements Span {
  readonly context: SpanContext
  readonly name = ''
  constructor(context: SpanContext) {
    this.context = context
  }
  setAttribute(): this { return this }
  setAttributes(): this { return this }
  addEvent(): this { return this }
  recordException(): this { return this }
  setStatus(): this { return this }
  updateName(): this { return this }
  end(): void { /* noop */ }
  isRecording(): boolean { return false }
}

export interface TracerOptions {
  resource: Resource
  sampler: Sampler
  scope: InstrumentationScope
  processor?: SpanProcessor
}

export class TracerImpl implements Tracer {
  constructor(private readonly opts: TracerOptions) {}

  getActiveSpan(): Span | undefined {
    return getActiveSpan()
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const kind = options.kind ?? 'INTERNAL'
    const parent =
      options.parent === null
        ? null
        : options.parent ?? getActiveSpan()?.context ?? null

    const traceId = parent?.traceId ?? generateTraceId()
    const spanId = generateSpanId()
    const attrs = options.attributes ?? {}

    const decision = this.opts.sampler.shouldSample(
      parent,
      traceId,
      name,
      kind,
      attrs,
    )
    if (decision.decision === 'DROP') {
      // Still emit a valid context so child spans can reference it, but
      // clear the sampled flag.
      return new NoopSpan({ traceId, spanId, traceFlags: 0 })
    }

    const sampled = decision.decision === 'RECORD_AND_SAMPLE'
    const context: SpanContext = {
      traceId,
      spanId,
      traceFlags: sampled ? 0x01 : 0x00,
    }

    const span = new SpanImpl({
      name,
      kind,
      context,
      parentSpanId: parent?.spanId,
      startTime: options.startTime ?? nowNs(),
      attributes: { ...(decision.attributes ?? {}), ...attrs },
      resource: this.opts.resource,
      scope: this.opts.scope,
      processor: this.opts.processor,
      recording: true,
    })

    this.opts.processor?.onStart(span)
    return span
  }

  startActiveSpan<T>(
    name: string,
    options: StartSpanOptions | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): T | Promise<T> {
    const span = this.startSpan(name, options)
    const run = () => {
      try {
        const result = fn(span)
        if (result instanceof Promise) {
          return result
            .catch((err) => {
              span.recordException(err)
              span.setStatus({ code: 'ERROR', message: String(err?.message ?? err) })
              throw err
            })
            .finally(() => span.end())
        }
        span.end()
        return result
      } catch (err) {
        span.recordException(err)
        span.setStatus({ code: 'ERROR', message: String((err as Error)?.message ?? err) })
        span.end()
        throw err
      }
    }
    // Use sync ALS.run; for promises ALS already propagates through await.
    const result = withActiveSpan(span, run)
    if (result instanceof Promise) {
      return withActiveSpanAsync(span, () => result)
    }
    return result
  }
}
