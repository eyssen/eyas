// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Minimal OpenTelemetry-compatible types for EYAS tracing.
 *
 * We intentionally reimplement a tiny subset of the OpenTelemetry API
 * instead of pulling the full SDK to keep the bundle small and MIT-aligned.
 * The wire format (OTLP/HTTP JSON) matches upstream OTel so Jaeger/Tempo/
 * Honeycomb accept our spans without translation.
 */

export type TraceId = string // 32 hex chars (16 bytes)
export type SpanId = string // 16 hex chars (8 bytes)

export type SpanKind =
  | 'INTERNAL'
  | 'SERVER'
  | 'CLIENT'
  | 'PRODUCER'
  | 'CONSUMER'

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR'

export interface SpanStatus {
  code: SpanStatusCode
  message?: string
}

export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[]

export type Attributes = Record<string, AttributeValue>

export interface SpanEvent {
  name: string
  timeUnixNano: bigint
  attributes?: Attributes
}

export interface SpanContext {
  traceId: TraceId
  spanId: SpanId
  traceFlags: number // 0x01 = sampled
  isRemote?: boolean
}

export interface ReadableSpan {
  name: string
  kind: SpanKind
  context: SpanContext
  parentSpanId?: SpanId
  startTimeUnixNano: bigint
  endTimeUnixNano?: bigint
  attributes: Attributes
  events: SpanEvent[]
  status: SpanStatus
  resource: Resource
  instrumentationScope: InstrumentationScope
}

export interface Span {
  readonly context: SpanContext
  readonly name: string
  setAttribute(key: string, value: AttributeValue): this
  setAttributes(attrs: Attributes): this
  addEvent(name: string, attributes?: Attributes): this
  recordException(error: Error | unknown): this
  setStatus(status: SpanStatus): this
  updateName(name: string): this
  end(endTime?: bigint): void
  isRecording(): boolean
}

export interface StartSpanOptions {
  kind?: SpanKind
  attributes?: Attributes
  startTime?: bigint
  parent?: SpanContext | null // null = explicit root
  links?: SpanLink[]
}

export interface SpanLink {
  context: SpanContext
  attributes?: Attributes
}

export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span
  startActiveSpan<T>(
    name: string,
    options: StartSpanOptions | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): T | Promise<T>
  getActiveSpan(): Span | undefined
}

export interface Resource {
  attributes: Attributes
}

export interface InstrumentationScope {
  name: string
  version?: string
}

/**
 * A span processor receives spans at start and end and decides when to export.
 */
export interface SpanProcessor {
  onStart(span: ReadableSpan): void
  onEnd(span: ReadableSpan): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Exporters send finished spans to an external backend.
 */
export interface SpanExporter {
  export(spans: ReadableSpan[]): Promise<ExportResult>
  shutdown(): Promise<void>
}

export interface ExportResult {
  code: 'SUCCESS' | 'FAILED'
  error?: Error
}

/**
 * Sampler decides whether a span is recorded and exported.
 */
export interface SamplingResult {
  decision: 'DROP' | 'RECORD_ONLY' | 'RECORD_AND_SAMPLE'
  attributes?: Attributes
}

export interface Sampler {
  shouldSample(
    parentContext: SpanContext | null,
    traceId: TraceId,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
  ): SamplingResult
  readonly description: string
}

export interface OtelServiceConfig {
  enabled: boolean
  serviceName: string
  serviceVersion?: string
  endpoint?: string // OTLP/HTTP base URL, default http://localhost:4318
  headers?: Record<string, string>
  sampler?: Sampler
  processor?: SpanProcessor
  exporter?: SpanExporter
  resourceAttributes?: Attributes
}

export interface OtelService {
  readonly tracer: Tracer
  readonly resource: Resource
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}
