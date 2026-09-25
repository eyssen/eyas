// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ReadableSpan, SpanExporter, SpanProcessor } from './types.js'

export interface BatchSpanProcessorOptions {
  /** Max queued spans before forcing a flush. Default 512. */
  maxQueueSize?: number
  /** Flush interval in ms. Default 5000. */
  scheduledDelayMs?: number
  /** Max spans sent in one export call. Default 128. */
  maxExportBatchSize?: number
  /** If true (default) drop oldest spans when queue is full. */
  dropOnOverflow?: boolean
}

/**
 * BatchSpanProcessor queues finished spans and flushes them either on
 * interval or when the batch size threshold is hit. Exports are async
 * and do not block span.end().
 */
export class BatchSpanProcessor implements SpanProcessor {
  private readonly queue: ReadableSpan[] = []
  private readonly maxQueueSize: number
  private readonly scheduledDelayMs: number
  private readonly maxExportBatchSize: number
  private readonly dropOnOverflow: boolean
  private timer: ReturnType<typeof setInterval> | null = null
  private shutdownPromise: Promise<void> | null = null
  private flushPromise: Promise<void> = Promise.resolve()

  constructor(
    private readonly exporter: SpanExporter,
    opts: BatchSpanProcessorOptions = {},
  ) {
    this.maxQueueSize = opts.maxQueueSize ?? 512
    this.scheduledDelayMs = opts.scheduledDelayMs ?? 5000
    this.maxExportBatchSize = opts.maxExportBatchSize ?? 128
    this.dropOnOverflow = opts.dropOnOverflow ?? true
    this.startTimer()
  }

  private startTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.flushOne()
    }, this.scheduledDelayMs)
    // Let Node/Bun exit even if this interval is pending.
    const t = this.timer as unknown as { unref?: () => void }
    t.unref?.()
  }

  onStart(_span: ReadableSpan): void {
    // Nothing to do at start; we only export on end.
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownPromise) return
    // Only record sampled spans (traceFlags & 0x01)
    if ((span.context.traceFlags & 0x01) !== 0x01) return
    if (this.queue.length >= this.maxQueueSize) {
      if (this.dropOnOverflow) {
        this.queue.shift()
      } else {
        return
      }
    }
    this.queue.push(span)
    if (this.queue.length >= this.maxExportBatchSize) {
      void this.flushOne()
    }
  }

  /** Flush exactly one batch (up to maxExportBatchSize). */
  private async flushOne(): Promise<void> {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0, this.maxExportBatchSize)
    this.flushPromise = this.flushPromise.then(async () => {
      try {
        await this.exporter.export(batch)
      } catch {
        // Swallow: exporter is responsible for its own retry / dead-letter.
      }
    })
    return this.flushPromise
  }

  async forceFlush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flushOne()
    }
    await this.flushPromise
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = (async () => {
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
      await this.forceFlush()
      await this.exporter.shutdown()
    })()
    return this.shutdownPromise
  }

  /** Test helper: current queue length. */
  get queueSize(): number {
    return this.queue.length
  }
}

/**
 * SimpleSpanProcessor exports every span immediately. Good for tests; bad
 * for production (high overhead).
 */
export class SimpleSpanProcessor implements SpanProcessor {
  private shutdownPromise: Promise<void> | null = null

  constructor(private readonly exporter: SpanExporter) {}

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    if (this.shutdownPromise) return
    if ((span.context.traceFlags & 0x01) !== 0x01) return
    void this.exporter.export([span]).catch(() => {
      /* swallow */
    })
  }

  async forceFlush(): Promise<void> {
    /* exports are synchronous-ish; nothing buffered */
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.exporter.shutdown()
    return this.shutdownPromise
  }
}
