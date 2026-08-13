---
name: prometheus-grafana
description: Application metrics with Prometheus client and Grafana dashboards
trigger_patterns:
  - "prometheus"
  - "grafana"
  - "metrics"
  - "monitoring"
  - "prom client"
capabilities:
  - devops
version: "1.0.0"
sources:
  - name: prom-client
    url: https://github.com/siimon/prom-client
    license: Apache-2.0
---
# Prometheus and Grafana

## Instrumenting with prom-client
```typescript
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});
```

## Metrics Endpoint
```typescript
app.get('/metrics', async (c) => {
  const metrics = await register.metrics();
  return c.text(metrics, 200, {
    'Content-Type': register.contentType,
  });
});
```

## Metric Types
- **Counter**: monotonically increasing (requests, errors)
- **Gauge**: can go up and down (active connections, queue size)
- **Histogram**: distribution of values (latency, response size)
- **Summary**: similar to histogram but calculates percentiles client-side

## Key Metrics to Track (RED Method)
- **Rate**: requests per second
- **Errors**: error rate (5xx responses)
- **Duration**: request latency percentiles (p50, p95, p99)

## Grafana Dashboard Tips
- Use variables for namespace, service, and instance filtering
- Set meaningful thresholds for color-coded panels
- Group related metrics in rows
- Include both current values and trends

## Best Practices
- Use consistent label names across services
- Keep cardinality low — avoid high-cardinality labels (user IDs, request IDs)
- Set appropriate histogram buckets for your SLA targets
- Expose `/metrics` on a separate port if possible (security)
