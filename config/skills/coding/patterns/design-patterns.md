---
name: design-patterns
description: Classic and modern design patterns for TypeScript applications
trigger_patterns:
  - "design pattern"
  - "factory pattern"
  - "strategy pattern"
  - "observer pattern"
  - "builder pattern"
capabilities:
  - coding
version: "1.0.0"
---
# Design Patterns for TypeScript

## Factory Pattern
```typescript
interface Handler { handle(req: Request): Promise<Response>; }

function createHandler(type: 'rest' | 'ws' | 'grpc'): Handler {
  const handlers = { rest: RestHandler, ws: WsHandler, grpc: GrpcHandler };
  return new handlers[type]();
}
```

## Strategy Pattern
```typescript
interface CompressionStrategy {
  compress(data: Buffer): Promise<Buffer>;
}

class FileProcessor {
  constructor(private strategy: CompressionStrategy) {}
  async process(file: Buffer) { return this.strategy.compress(file); }
}
```

## Observer / Event Emitter
```typescript
type Listener<T> = (event: T) => void;

class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<any>>>();
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>) { ... }
  emit<K extends keyof Events>(event: K, data: Events[K]) { ... }
}
```

## Builder Pattern
```typescript
class QueryBuilder {
  private filters: Filter[] = [];
  where(field: string, op: Op, value: unknown) { this.filters.push({ field, op, value }); return this; }
  limit(n: number) { this.n = n; return this; }
  build(): Query { return { filters: this.filters, limit: this.n }; }
}
```

## When to Use What
- **Factory** — object creation varies by input
- **Strategy** — swap algorithms at runtime
- **Observer** — decouple producer from consumers
- **Builder** — complex object construction with many optional params
