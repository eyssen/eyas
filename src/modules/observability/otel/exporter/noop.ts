// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ExportResult, ReadableSpan, SpanExporter } from '../types.js'

/**
 * NoopExporter discards spans. Useful when the feature is toggled off but
 * code still wants to call exporter.export() without guarding.
 */
export class NoopExporter implements SpanExporter {
  async export(_spans: ReadableSpan[]): Promise<ExportResult> {
    return { code: 'SUCCESS' }
  }
  async shutdown(): Promise<void> {
    /* noop */
  }
}
