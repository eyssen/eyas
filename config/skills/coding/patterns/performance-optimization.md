---
name: performance-optimization
description: Profiling, caching, memory management, and optimization techniques
trigger_patterns:
  - "performance"
  - "optimization"
  - "profiling"
  - "caching"
  - "memory leak"
  - "bottleneck"
capabilities:
  - coding
version: "1.0.0"
---
# Performance Optimization

## Measure First
Never optimize without profiling. Use concrete data:
- **Bun/Node**: `--inspect` + Chrome DevTools profiler
- **HTTP**: response time percentiles (p50, p95, p99)
- **Memory**: heap snapshots to find leaks
- **DB**: `EXPLAIN ANALYZE` on slow queries

## Caching Strategies
```typescript
// In-memory LRU cache
const cache = new Map<string, { value: T; expires: number }>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return Promise.resolve(entry.value);
  return fn().then(value => {
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  });
}
```

## Common Bottlenecks
- **N+1 queries** — batch with `IN` clause or eager loading
- **Synchronous I/O** — use async APIs, never `fs.readFileSync` in request handlers
- **Large JSON parsing** — stream with `JSON.parse` on chunks or use binary protocols
- **Unbounded collections** — always paginate, limit array sizes
- **Regex backtracking** — avoid nested quantifiers `(a+)+`

## Memory Management
- Avoid closures capturing large objects — extract what you need
- Use `WeakMap` / `WeakRef` for caches that should not prevent GC
- Clear intervals and event listeners on cleanup
- Stream large files instead of buffering entirely

## Database Optimization
- Add indexes for frequent WHERE/JOIN columns
- Use connection pooling
- Batch inserts with transactions
- Denormalize read-heavy data cautiously

## Rules of Thumb
- Optimize the hot path — ignore code that runs rarely
- Algorithmic improvements beat micro-optimizations
- Premature optimization is the root of all evil — profile first
