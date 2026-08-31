// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  Attributes,
  AttributeValue,
  ExportResult,
  ReadableSpan,
  Resource,
  SpanExporter,
} from '../types.js'

export interface OtlpHttpExporterOptions {
  /** Full URL to OTLP/HTTP traces endpoint. Default http://localhost:4318/v1/traces */
  endpoint?: string
  /** Extra HTTP headers (e.g. API key for Honeycomb, auth for Grafana Cloud). */
  headers?: Record<string, string>
  /** Timeout for a single HTTP request in ms. Default 10000. */
  timeoutMs?: number
  /** Max retries on 5xx / network error. Default 3. */
  maxRetries?: number
  /** Max body size in bytes before splitting. Default 4 MiB. */
  maxBodyBytes?: number
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch
  /** Base backoff in ms. Default 100. Applied as base * 2^attempt. */
  backoffBaseMs?: number
  /** Deterministic setTimeout for tests. */
  setTimeoutImpl?: typeof setTimeout
}

/**
 * OtlpHttpExporter sends spans via OTLP/HTTP using the JSON wire format.
 * Protocol reference: https://opentelemetry.io/docs/specs/otlp/#otlphttp
 *
 * We use JSON (not protobuf) because:
 *  1. Zero extra dependencies (protobuf would require a schema codegen step).
 *  2. All mainstream backends (Jaeger v2, Tempo, Grafana Cloud, Honeycomb,
 *     New Relic, Datadog via forwarder) accept OTLP/HTTP+JSON.
 *  3. Debuggable by humans (curl-friendly).
 *
 * OTLP JSON schema encodes integers as strings when they would overflow
 * JSON's safe range (e.g. unixNanos as string). We follow that rule.
 */
export class OtlpHttpExporter implements SpanExporter {
  private readonly endpoint: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly maxBodyBytes: number
  private readonly fetchImpl: typeof fetch
  private readonly backoffBaseMs: number
  private readonly setTimeoutImpl: typeof setTimeout
  private shutdownFlag = false

  constructor(opts: OtlpHttpExporterOptions = {}) {
    this.endpoint = opts.endpoint ?? 'http://localhost:4318/v1/traces'
    this.headers = {
      'content-type': 'application/json',
      ...(opts.headers ?? {}),
    }
    this.timeoutMs = opts.timeoutMs ?? 10_000
    this.maxRetries = opts.maxRetries ?? 3
    this.maxBodyBytes = opts.maxBodyBytes ?? 4 * 1024 * 1024
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch)
    this.backoffBaseMs = opts.backoffBaseMs ?? 100
    this.setTimeoutImpl = opts.setTimeoutImpl ?? setTimeout
  }

  async export(spans: ReadableSpan[]): Promise<ExportResult> {
    if (this.shutdownFlag) return { code: 'FAILED', error: new Error('shutdown') }
    if (spans.length === 0) return { code: 'SUCCESS' }
    try {
      const chunks = this.splitIntoChunks(spans)
      for (const chunk of chunks) {
        const body = JSON.stringify(chunk)
        const ok = await this.sendWithRetry(body)
        if (!ok) return { code: 'FAILED', error: new Error('export failed after retries') }
      }
      return { code: 'SUCCESS' }
    } catch (err) {
      return { code: 'FAILED', error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async shutdown(): Promise<void> {
    this.shutdownFlag = true
  }

  /**
   * Build OTLP payloads, splitting into multiple chunks if total serialized
   * size would exceed maxBodyBytes. We greedily pack spans sharing the same
   * resource into a single ResourceSpans block.
   */
  private splitIntoChunks(spans: ReadableSpan[]): OtlpTracesPayload[] {
    // For simplicity we assume a single resource per tracer instance (our
    // createOtelService enforces this). Fall back to per-span grouping if
    // callers mix resources.
    const byResource = new Map<string, { resource: Resource; spans: ReadableSpan[] }>()
    for (const s of spans) {
      const key = JSON.stringify(s.resource.attributes)
      const existing = byResource.get(key)
      if (existing) existing.spans.push(s)
      else byResource.set(key, { resource: s.resource, spans: [s] })
    }

    const chunks: OtlpTracesPayload[] = []
    let current: OtlpTracesPayload = { resourceSpans: [] }
    let currentSize = 2 // '{}' baseline

    const flush = () => {
      if (current.resourceSpans.length > 0) chunks.push(current)
      current = { resourceSpans: [] }
      currentSize = 2
    }

    for (const group of byResource.values()) {
      const rs = {
        resource: { attributes: toKeyValueList(group.resource.attributes) },
        scopeSpans: [
          {
            scope: { name: 'eyas.observability.otel', version: '0.1.0' },
            spans: group.spans.map((s) => toOtlpSpan(s)),
          },
        ],
      }
      const size = JSON.stringify(rs).length
      if (currentSize + size > this.maxBodyBytes && current.resourceSpans.length > 0) {
        flush()
      }
      current.resourceSpans.push(rs)
      currentSize += size
    }
    flush()
    return chunks
  }

  private async sendWithRetry(body: string): Promise<boolean> {
    let attempt = 0
    let lastError: unknown
    while (attempt <= this.maxRetries) {
      try {
        const controller = new AbortController()
        const timeoutId = this.setTimeoutImpl(() => controller.abort(), this.timeoutMs)
        let res: Response
        try {
          res = await this.fetchImpl(this.endpoint, {
            method: 'POST',
            headers: this.headers,
            body,
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId as unknown as ReturnType<typeof setTimeout>)
        }
        if (res.ok) return true
        if (res.status >= 500 || res.status === 429) {
          lastError = new Error(`HTTP ${res.status}`)
          attempt++
          if (attempt > this.maxRetries) break
          await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1))
          continue
        }
        // 4xx other than 429 = don't retry, drop
        return false
      } catch (err) {
        lastError = err
        attempt++
        if (attempt > this.maxRetries) break
        await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1))
      }
    }
    // Dropped after exhausting retries.
    void lastError
    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeoutImpl(resolve, ms))
  }
}

// ---------- OTLP JSON schema (trimmed) ----------

interface OtlpTracesPayload {
  resourceSpans: OtlpResourceSpans[]
}

interface OtlpResourceSpans {
  resource: { attributes: OtlpKeyValue[] }
  scopeSpans: OtlpScopeSpans[]
}

interface OtlpScopeSpans {
  scope: { name: string; version?: string }
  spans: OtlpSpan[]
}

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number // 1=internal 2=server 3=client 4=producer 5=consumer
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpKeyValue[]
  events: OtlpEvent[]
  status: { code: number; message?: string }
}

interface OtlpEvent {
  timeUnixNano: string
  name: string
  attributes: OtlpKeyValue[]
}

interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: OtlpAnyValue[] } }

function toOtlpSpan(s: ReadableSpan): OtlpSpan {
  const kindMap: Record<string, number> = {
    INTERNAL: 1,
    SERVER: 2,
    CLIENT: 3,
    PRODUCER: 4,
    CONSUMER: 5,
  }
  const statusMap: Record<string, number> = { UNSET: 0, OK: 1, ERROR: 2 }
  return {
    traceId: s.context.traceId,
    spanId: s.context.spanId,
    parentSpanId: s.parentSpanId,
    name: s.name,
    kind: kindMap[s.kind] ?? 1,
    startTimeUnixNano: s.startTimeUnixNano.toString(),
    endTimeUnixNano: (s.endTimeUnixNano ?? s.startTimeUnixNano).toString(),
    attributes: toKeyValueList(s.attributes),
    events: s.events.map((e) => ({
      timeUnixNano: e.timeUnixNano.toString(),
      name: e.name,
      attributes: toKeyValueList(e.attributes ?? {}),
    })),
    status: {
      code: statusMap[s.status.code] ?? 0,
      message: s.status.message,
    },
  }
}

function toKeyValueList(attrs: Attributes): OtlpKeyValue[] {
  const out: OtlpKeyValue[] = []
  for (const key of Object.keys(attrs)) {
    const v = attrs[key]!
    out.push({ key, value: toAnyValue(v) })
  }
  return out
}

function toAnyValue(v: AttributeValue): OtlpAnyValue {
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { boolValue: v }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { intValue: v.toString() } : { doubleValue: v }
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map((x) => toAnyValue(x as AttributeValue)) } }
  }
  return { stringValue: String(v) }
}
