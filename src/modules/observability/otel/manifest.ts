// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Manifest for the observability/otel submodule.
 *
 * This submodule exposes an OpenTelemetry-compatible Tracer and OTLP/HTTP
 * exporter. It has no runtime deps on @opentelemetry/* packages; instead
 * we implement the minimal subset required to produce valid OTLP JSON
 * bodies consumed by Jaeger, Tempo, Honeycomb, Grafana Cloud etc.
 */
export const manifest = {
  name: 'observability.otel',
  version: '0.1.0',
  description:
    'Minimal OpenTelemetry tracing: spans, OTLP/HTTP export, samplers, W3C context propagation.',
  tier: 'optional' as const,
  dependsOn: ['logger'] as const,
  defaultEnabled: false,
  capabilities: {
    providesTracer: true,
    httpMiddleware: true,
    wrapsAgentRun: true,
    wrapsToolCall: true,
    wrapsModelCall: true,
  },
} as const

export type ObservabilityOtelManifest = typeof manifest
