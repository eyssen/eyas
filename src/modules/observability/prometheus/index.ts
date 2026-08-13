// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { DEFAULT_MAX_CARDINALITY, Registry } from './registry.js'
import {
  registerAgentMetrics,
  registerHttpMetrics,
  registerModelMetrics,
  registerRuntimeMetrics,
  registerToolMetrics,
  type AgentMetrics,
  type HttpMetrics,
  type ModelMetrics,
  type RuntimeMetrics,
  type ToolMetrics,
} from './collectors/index.js'
import { registerPrometheusRoutes } from './routes.js'
import type { PrometheusExporterConfig } from './types.js'

export type { PrometheusExporterConfig } from './types.js'
export { Registry, Counter, Gauge, Histogram } from './registry.js'
export { scrape, formatFamily, DEFAULT_MAX_SCRAPE_BYTES } from './formatter.js'
export { registerPrometheusRoutes, PROMETHEUS_CONTENT_TYPE } from './routes.js'

export interface PrometheusExporterDeps {
  http: Hono
  bus: EyasBus
  logger: Logger
  config?: PrometheusExporterConfig
}

export interface PrometheusExporter {
  registry: Registry
  agent: AgentMetrics
  tool: ToolMetrics
  model: ModelMetrics
  http: HttpMetrics
  runtime: RuntimeMetrics
  stop(): void
}

/**
 * Construct and wire up the Prometheus exporter subsystem.
 *
 * Registers a fresh {@link Registry}, attaches the standard collectors,
 * subscribes them to the event bus, and mounts `GET /metrics` on the
 * provided Hono app.
 *
 * The parent observability module should call this from its `onStart`.
 */
export function createPrometheusExporter(deps: PrometheusExporterDeps): PrometheusExporter {
  const cfg = deps.config ?? {}
  const registry = new Registry({
    maxCardinality: cfg.maxCardinalityPerMetric ?? DEFAULT_MAX_CARDINALITY,
  })

  const agent = registerAgentMetrics(registry, deps.bus, deps.logger)
  const tool = registerToolMetrics(registry, deps.bus, deps.logger)
  const model = registerModelMetrics(registry, deps.bus, deps.logger)
  const httpMetrics = registerHttpMetrics(registry, deps.bus, deps.logger)
  const runtime = registerRuntimeMetrics(registry, deps.bus, deps.logger)

  registerPrometheusRoutes(deps.http, {
    registry,
    config: cfg,
    logger: deps.logger,
    onBeforeScrape: () => runtime.collect(),
  })

  deps.logger.info(
    { metricCount: registry.listMetrics().length },
    'Prometheus exporter initialized',
  )

  return {
    registry,
    agent,
    tool,
    model,
    http: httpMetrics,
    runtime,
    stop() {
      runtime.stop()
    },
  }
}
