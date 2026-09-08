# observability/otel

OpenTelemetry-compatible distributed tracing for EYAS. Exports spans via OTLP/HTTP JSON to any OTel backend (Jaeger, Grafana Tempo, Honeycomb, Grafana Cloud, New Relic, Datadog forwarder, etc.).

## Design choices

- **Build-it-yourself, not `@opentelemetry/*`.** We implement the minimal slice of the OTel tracing API we actually need. Upshot: zero new deps, no Apache-2.0 transitive tree, a bundle footprint measured in kilobytes. If we ever need metrics or logs pipelines we can adopt upstream packages — they are Apache-2.0 which is MIT-compatible.
- **OTLP/HTTP JSON wire format.** JSON is human-debuggable and universally accepted. No protobuf codegen step, no schema file to bundle.
- **AsyncLocalStorage for active-span propagation** — matches the upstream SDK pattern and works transparently across `await`.

## Quick start

```ts
import { createOtelService, OtlpHttpExporter, BatchSpanProcessor } from '@modules/observability/otel'

const otel = createOtelService({
  enabled: true,
  serviceName: 'eyas',
  serviceVersion: '0.8.6-beta',
  endpoint: 'http://localhost:4318/v1/traces',
  exporter: new OtlpHttpExporter({
    endpoint: 'http://localhost:4318/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HC_KEY! },
  }),
})

const { tracer } = otel

await tracer.startActiveSpan('my.operation', { kind: 'INTERNAL' }, async (span) => {
  span.setAttribute('eyas.custom', 1)
  // ... work ...
})

await otel.shutdown() // on process exit
```

## Instrumentation wrap points (integration TODO)

These are documented rather than applied — the target modules are owned by other tracks. Each wrap point is designed so applying it is a one-liner.

| Target | Wrap call | Suggested file |
| --- | --- | --- |
| Agent turn runtime | `instrumentAgentRun(tracer)(runTurn)` | `src/modules/agent/runtime.ts` |
| Tool executor | `instrumentToolCall(tracer)(executeTool)` | `src/modules/tools/executor.ts` |
| Model provider `call()` | `instrumentModelCall(tracer)(providerCall)` | `src/modules/model/providers/*` |
| Hono router | `app.use('*', honoOtelMiddleware(tracer))` | `src/modules/http/index.ts` |
| WebSocket frames | call `tracer.startSpan('ws.message', { kind: 'SERVER' })` from the WS dispatcher | `src/modules/websocket/*` |

## Cross-process propagation

When calling a remote A2A peer or an MCP server, include the active W3C `traceparent` header in the message envelope:

```ts
import { getActiveSpan, formatTraceparent } from '@modules/observability/otel'

const span = getActiveSpan()
if (span) envelope.headers['traceparent'] = formatTraceparent(span.context)
```

On receive, `parseTraceparent(envelope.headers['traceparent'])` yields a `SpanContext` you can pass as `options.parent` to `startSpan`.

## Sampling

Default: `ParentBased(root=TraceIdRatioSampler(0.1))` — keeps 10% of root traces, honours sampling decisions from upstream services. Override via `OtelServiceConfig.sampler`.

## Semantic conventions applied

### HTTP
- `http.method` — uppercase verb
- `http.route` — route template (`/api/v1/users/:id`)
- `http.url` — full URL
- `http.status_code` — integer

### Agent (EYAS-specific)
- `eyas.agent.id`, `eyas.agent.name`
- `eyas.session.id`, `eyas.turn`, `eyas.user.id`

### Tool (EYAS-specific)
- `eyas.tool.name`, `eyas.tool.risk_tier`
- `eyas.tool.result` (`success` / `error`), `eyas.tool.duration_ms`
- `eyas.tool.args_summary`, `eyas.tool.call_id`

### Model (EYAS-specific)
- `eyas.model.provider`, `eyas.model.name`, `eyas.model.operation`, `eyas.model.streaming`
- `eyas.model.usage.input_tokens`, `eyas.model.usage.output_tokens`
- `eyas.model.usage.cached_input_tokens`, `eyas.model.usage.reasoning_tokens`
- `eyas.model.usage.cost_usd`

### Exception events
- `exception.type`, `exception.message`, `exception.stacktrace` (attached as a span event named `exception`)

## Security / privacy

- Attribute values you attach travel to your OTel backend. Don't attach secrets, prompts with PII, or raw LLM outputs without scrubbing first. `eyas.tool.args_summary` is meant to be a sanitised description, not raw args.
- The exporter silently drops spans after retries exhaust — tracing failure never cascades into app failure.

## License

MIT, part of the EYAS project. No runtime deps added.
