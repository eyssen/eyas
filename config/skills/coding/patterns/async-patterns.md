---
name: async-patterns
description: Async/await, concurrency control, and parallel execution patterns
trigger_patterns:
  - "async await"
  - "promise"
  - "concurrency"
  - "parallel execution"
  - "race condition"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: p-limit
    url: https://github.com/sindresorhus/p-limit
    license: MIT
  - name: p-queue
    url: https://github.com/sindresorhus/p-queue
    license: MIT
---
# Async Patterns

## Parallel with Promise.all
```typescript
const [users, orders] = await Promise.all([
  fetchUsers(),
  fetchOrders(),
]);
```

## Concurrency Limiting
```typescript
import pLimit from 'p-limit';
const limit = pLimit(5);  // max 5 concurrent

const results = await Promise.all(
  urls.map(url => limit(() => fetch(url)))
);
```

## Priority Queue
```typescript
import PQueue from 'p-queue';
const queue = new PQueue({ concurrency: 3 });

queue.add(() => highPriorityTask(), { priority: 1 });
queue.add(() => lowPriorityTask(), { priority: 0 });
await queue.onIdle();
```

## Promise.allSettled for Partial Failures
```typescript
const results = await Promise.allSettled(tasks);
const succeeded = results.filter(r => r.status === 'fulfilled');
const failed = results.filter(r => r.status === 'rejected');
```

## Timeout Pattern
```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}
```

## Anti-Patterns
- Avoid `await` inside loops — use `Promise.all` instead
- Never fire-and-forget promises without error handling
- Do not mix callbacks and promises in the same flow
- Always use `AbortController` for cancellable operations
