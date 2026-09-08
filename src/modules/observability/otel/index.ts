// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { NoopExporter } from './exporter/noop.js'
import { BatchSpanProcessor } from './span-processor.js'
import { defaultSampler } from './sampler.js'
import { TracerImpl } from './tracer.js'
import type {
  OtelService,
  OtelServiceConfig,
  Resource,
  SpanProcessor,
  Tracer,
} from './types.js'

export * from './types.js'
export { parseTraceparent, formatTraceparent, getActiveSpan } from './context.js'
export { AlwaysOnSampler, AlwaysOffSampler, TraceIdRatioSampler, ParentBasedSampler, defaultSampler } from './sampler.js'
export { BatchSpanProcessor, SimpleSpanProcessor } from './span-processor.js'
export { ConsoleExporter } from './exporter/console.js'
export { NoopExporter } from './exporter/noop.js'
export { OtlpHttpExporter } from './exporter/otlp-http.js'
export * from './instrumentations/index.js'
export { TracerImpl } from './tracer.js'
export { manifest } from './manifest.js'

/**
 * Construct an OtelService with sensible defaults.
 *
 * Caller-provided dependencies take precedence; otherwise we use a Noop
 * exporter + BatchProcessor when `enabled:false`, or the provided exporter
 * when enabled.
 */
export function createOtelService(config: OtelServiceConfig): OtelService {
  const resource: Resource = {
    attributes: {
      'service.name': config.serviceName,
      ...(config.serviceVersion ? { 'service.version': config.serviceVersion } : {}),
      ...(config.resourceAttributes ?? {}),
    },
  }

  const exporter = config.exporter ?? new NoopExporter()
  const processor: SpanProcessor =
    config.processor ??
    (config.enabled ? new BatchSpanProcessor(exporter) : new BatchSpanProcessor(new NoopExporter()))

  const sampler = config.sampler ?? defaultSampler()

  const tracer: Tracer = new TracerImpl({
    resource,
    sampler,
    scope: { name: 'eyas.observability.otel', version: '0.1.0' },
    processor,
  })

  return {
    tracer,
    resource,
    forceFlush: () => processor.forceFlush(),
    shutdown: () => processor.shutdown(),
  }
}
