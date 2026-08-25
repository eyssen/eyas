// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createObservabilityTables } from './schema.js'
import { createContextTables, purgeContextDetail } from './context-schema.js'
import { createContextRecorder } from './context-recorder.js'
import { createTraceCollector, wrapGatewayWithTracing } from './trace-collector.js'
import { createObservabilityRoutes } from './routes.js'
import { createContextRoutes } from './context-routes.js'
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
    createContextTables(ctx.db)
    ctx.logger.info('Observability module registered')
  },

  async onStart(ctx: ModuleContext) {
    const collector = createTraceCollector(ctx.db)
    const contextRecorder = createContextRecorder(ctx.db, ctx.logger)
    ;(ctx as any).contextRecorder = contextRecorder

    // Wrap the model gateway with tracing instrumentation
    ctx.model = wrapGatewayWithTracing(ctx.model, collector, ctx)

    // Register REST API routes
    createObservabilityRoutes(ctx.http, collector, ctx)
    createContextRoutes(ctx.http, ctx.db)

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

    // Register + seed the context-detail retention purge job. The detail
    // layer (context_compositions/context_sections) is short-retention by
    // design — context_section_daily is the long-lived rollup, never touched
    // here — so this runs nightly and logs what it removes: a purge that
    // fails silently is exactly the kind of thing nobody notices until data
    // is missing. Handler registration is unconditional (it only populates
    // the in-memory handler map, so it must happen every process start);
    // seeding the job row happens once.
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      if (scheduler && typeof scheduler.registerHandler === 'function') {
        const retentionDays = ctx.config.observability?.contextRetentionDays ?? 7
        scheduler.registerHandler('observability.context.purge', async () => {
          const removed = purgeContextDetail(ctx.db, retentionDays)
          ctx.logger.info({ ...removed, retentionDays }, 'Purged context composition detail')
          return removed
        })

        const existing = scheduler.list()
        if (!existing.some((j: any) => j.handler === 'observability.context.purge')) {
          scheduler.create({
            name: 'Context detail retention',
            description: 'Purge context_compositions/context_sections older than the retention window',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '15 3 * * *' }),
            handler: 'observability.context.purge',
            source: 'system',
            kind: 'handler',
            category: 'maintenance',
          })
          ctx.logger.info('Seeded context detail retention job')
        }
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
