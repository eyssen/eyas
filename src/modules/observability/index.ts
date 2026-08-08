// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createObservabilityTables } from './schema.js'
import { createTraceCollector, wrapGatewayWithTracing } from './trace-collector.js'
import { createObservabilityRoutes } from './routes.js'
import { runAnomalyDetection } from './anomaly-detector.js'
import {
  createPrometheusExporter,
  type PrometheusExporter,
  type PrometheusExporterConfig,
} from './prometheus/index.js'
import {
  createOtelService,
  OtlpHttpExporter,
  NoopExporter,
  type OtelService,
} from './otel/index.js'

export const observabilityModule: EyasModule = {
  id: 'observability',
  name: 'Observability',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'AI trace collector, anomaly detection, quality scoring, and cost dashboard',
  dependencies: ['model'],

  async onRegister(ctx: ModuleContext) {
    createObservabilityTables(ctx.db)
    ctx.logger.info('Observability module registered')
  },

  async onStart(ctx: ModuleContext) {
    const collector = createTraceCollector(ctx.db)

    // Wrap the model gateway with tracing instrumentation
    ctx.model = wrapGatewayWithTracing(ctx.model, collector, ctx)

    // Register REST API routes
    createObservabilityRoutes(ctx.http, collector, ctx)

    // Prometheus /metrics exporter. Secret-driven config so operators can
    // harden the endpoint without hard-coding credentials:
    //   - EYAS secret 'prometheus-bearer-token'  → Bearer auth (optional)
    //   - EYAS secret 'prometheus-ip-allowlist'  → CSV of allowed scraper IPs
    // Absent: endpoint is open (standard Prometheus pull semantics inside a
    // trusted network). Bind mounts the exporter on ctx.observability so
    // other modules can reach the metric instruments for direct recording.
    const bearer = ctx.hasModule('secrets')
      ? (await ctx.secrets.get('prometheus-bearer-token', 'system')) ?? undefined
      : undefined
    const ipCsv = ctx.hasModule('secrets')
      ? (await ctx.secrets.get('prometheus-ip-allowlist', 'system')) ?? undefined
      : undefined
    const prometheusConfig: PrometheusExporterConfig = {
      enabled: true,
      bearerToken: bearer,
      ipAllowlist: ipCsv ? ipCsv.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    }
    const exporter: PrometheusExporter = createPrometheusExporter({
      http: ctx.http,
      bus: ctx.bus,
      logger: ctx.logger,
      config: prometheusConfig,
    })

    // OpenTelemetry tracing service. Disabled by default — only ships spans
    // to a collector when 'otel-endpoint' secret is set. Absent endpoint
    // keeps a noop processor so instrumentations can still call
    // tracer.startSpan() without runtime cost or network traffic.
    const otelEndpoint = ctx.hasModule('secrets')
      ? (await ctx.secrets.get('otel-endpoint', 'system')) ?? undefined
      : undefined
    const otelHeadersRaw = ctx.hasModule('secrets')
      ? (await ctx.secrets.get('otel-headers', 'system')) ?? undefined
      : undefined
    // Headers secret is CSV of k=v pairs (e.g. "x-honeycomb-team=abc,x-api-key=xyz").
    // Avoids JSON-in-a-secret which is awkward to rotate.
    const otelHeaders: Record<string, string> = {}
    if (otelHeadersRaw) {
      for (const pair of otelHeadersRaw.split(',')) {
        const [k, v] = pair.split('=', 2).map(s => s.trim())
        if (k && v) otelHeaders[k] = v
      }
    }
    const otel: OtelService = createOtelService({
      serviceName: 'eyas',
      serviceVersion: ctx.config.server ? `${ctx.config.server.port}` : undefined,
      enabled: !!otelEndpoint,
      exporter: otelEndpoint
        ? new OtlpHttpExporter({ endpoint: otelEndpoint, headers: otelHeaders })
        : new NoopExporter(),
    })
    if (otelEndpoint) {
      ctx.logger.info({ otelEndpoint }, 'OpenTelemetry tracing enabled')
    }

    ;(ctx as any).observability = { collector, prometheus: exporter, otel }

    // Schedule hourly anomaly detection if scheduler is available
    if (ctx.hasModule('scheduler')) {
      try {
        const scheduler = ctx.getModule<any>('scheduler')
        if (scheduler?.registerJob) {
          scheduler.registerJob({
            id: 'observability-anomaly-check',
            name: 'AI Anomaly Detection',
            cron: '0 * * * *', // Every hour
            handler: () => runAnomalyDetection(collector, ctx),
          })
        }
      } catch {
        // Scheduler integration is optional
      }
    }

    ctx.logger.info('Observability module started — tracing + Prometheus /metrics active')
  },

  async onStop(ctx?: ModuleContext) {
    // Stop the runtime-metrics sampler's interval timer and flush any
    // pending OTel spans before the process exits. Important for Kubernetes
    // pod termination (SIGTERM → 30s grace) and for vitest cleanup.
    if (ctx) {
      const obs = (ctx as any).observability
      obs?.prometheus?.stop?.()
      try {
        await obs?.otel?.forceFlush?.()
        await obs?.otel?.shutdown?.()
      } catch {
        // Shutdown is best-effort; don't block teardown on exporter errors.
      }
    }
  },
}
