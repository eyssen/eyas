// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ExportResult, ReadableSpan, SpanExporter } from '../types.js'

export interface ConsoleExporterOptions {
  /** Override for tests / custom log sinks. */
  write?: (line: string) => void
}

/**
 * ConsoleExporter prints one JSON line per span. Intended for local
 * development and integration tests; not for production.
 */
export class ConsoleExporter implements SpanExporter {
  private readonly write: (line: string) => void
  constructor(opts: ConsoleExporterOptions = {}) {
    // Allow dependency injection of the log sink to keep tests hermetic.
    this.write = opts.write ?? ((line) => process.stdout.write(line + '\n'))
  }

  async export(spans: ReadableSpan[]): Promise<ExportResult> {
    for (const s of spans) {
      const durMs =
        s.endTimeUnixNano !== undefined
          ? Number((s.endTimeUnixNano - s.startTimeUnixNano) / 1_000_000n)
          : null
      this.write(
        JSON.stringify({
          type: 'otel.span',
          traceId: s.context.traceId,
          spanId: s.context.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name,
          kind: s.kind,
          durationMs: durMs,
          status: s.status,
          attributes: s.attributes,
          eventCount: s.events.length,
        }),
      )
    }
    return { code: 'SUCCESS' }
  }

  async shutdown(): Promise<void> {
    /* noop */
  }
}
