# Prometheus Exporter

Zero-dependency Prometheus text exposition endpoint (`/metrics`) for EYAS. Lives as
a submodule under `observability/`; can be toggled independently.

## Metrics

### Counters

- `eyas_agent_sessions_total{status}` — `running|completed|failed|waiting_approval`
- `eyas_agent_turns_total{agent_id,outcome}`
- `eyas_agent_tokens_total{agent_id,provider,kind}` — `kind=input|output|thinking`
- `eyas_agent_cost_usd_total{agent_id}`
- `eyas_tool_calls_total{tool_name,result}` — `result=success|error|timeout|denied`
- `eyas_model_calls_total{provider,model,outcome}`
- `eyas_http_requests_total{method,route,status}`
- `eyas_process_cpu_seconds_total`

### Gauges

- `eyas_process_resident_memory_bytes`
- `eyas_process_start_time_seconds`
- `eyas_event_loop_lag_seconds`
- `eyas_scheduler_leader{instance_id}` — 1 or 0
- `eyas_agent_budget_usage_ratio{agent_id}` — 0..1+
- `eyas_active_teams_total`

### Histograms

- `eyas_tool_duration_ms{tool_name}` — buckets: 10, 50, 100, 500, 1000, 5000, 30000
- `eyas_model_latency_ms{provider,model}` — buckets: 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000
- `eyas_http_duration_ms{method,route}` — buckets: 5, 10, 25, 50, 100, 250, 500, 1000, 5000

## Registry implementation

The registry is written from scratch (no `prom-client`) — see `registry.ts`. It
provides `Counter`, `Gauge`, and `Histogram`, enforces Prometheus naming rules
for metric and label names, and supports a configurable per-metric cardinality
cap.

## Cardinality protection

Each metric family independently tracks its unique label-set count. When the
count would exceed the configured `maxCardinalityPerMetric` (default: 10 000),
new label-sets are **silently dropped** (the counter/gauge call becomes a
no-op) and a `CardinalityWarning` is appended to the registry. The first
warning is also emitted via `logger.warn` on the next scrape.

Operators can tune the cap via `PrometheusExporterConfig.maxCardinalityPerMetric`.

## Security

- `/metrics` has **no auth** by default (standard pull model behind internal LAN).
- Set `config.bearerToken` to require `Authorization: Bearer <token>`.
- Set `config.ipAllowlist` to restrict by source IP (reads `X-Forwarded-For` / `X-Real-IP`).
- Response is capped at `config.maxResponseBytes` (default 10 MB); if the cap
  is hit, the tail is truncated at a family boundary and `X-Eyas-Metrics-Truncated: 1`
  is set.
- Label values are never used to carry user IDs directly — callers should hash
  any potentially identifying material before putting it into a label.

## Bus subscriptions

The collectors listen on well-defined subjects (see each collector for the
full list). Example:

```ts
// somewhere in the agent module
bus.emit('agent.session.completed', { agentId: 'agt_42', status: 'completed' })
bus.emit('agent.tokens.used', { agentId: 'agt_42', provider: 'anthropic', kind: 'output', amount: 512 })
bus.emit('tool.executed', { toolName: 'shell', result: 'success', durationMs: 137 })
bus.emit('http.request.completed', { method: 'GET', route: '/api/v1/users/:id', status: 200, durationMs: 22 })
```

The Prometheus exporter does not mutate or depend on the emitter modules —
emitters simply publish on the bus, and the collectors pick it up.

## Integration

```ts
import { createPrometheusExporter } from '@modules/observability/prometheus'

const exporter = createPrometheusExporter({
  http: ctx.http,
  bus: ctx.bus,
  logger: ctx.logger,
  config: {
    bearerToken: process.env.EYAS_METRICS_TOKEN,
    maxCardinalityPerMetric: 10_000,
  },
})

// on shutdown:
// exporter.stop()
```
