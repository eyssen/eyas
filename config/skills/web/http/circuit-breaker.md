---
name: circuit-breaker
description: Circuit breaker pattern for resilient service communication with cockatiel
trigger_patterns:
  - "circuit breaker"
  - "resilience"
  - "fault tolerance"
  - "cockatiel"
  - "bulkhead"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: cockatiel
    url: https://github.com/connor4312/cockatiel
    license: MIT
---
# Circuit Breaker Pattern

## Concept
The circuit breaker prevents cascading failures by stopping requests to a failing service and allowing it to recover.

**States:**
1. **Closed**: requests flow normally, failures are counted
2. **Open**: all requests fail immediately (fast-fail), no load on the service
3. **Half-Open**: limited requests allowed to test if the service has recovered

## Implementation with cockatiel
```typescript
import { CircuitBreakerPolicy, ConsecutiveBreaker, handleAll, retry, wrap } from 'cockatiel';

// Circuit breaker: open after 5 consecutive failures, try again after 30s
const breaker = new CircuitBreakerPolicy(handleAll, {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

breaker.onBreak(() => console.warn('Circuit opened — service unavailable'));
breaker.onReset(() => console.info('Circuit closed — service recovered'));

// Use the breaker
try {
  const result = await breaker.execute(() => fetch('https://api.example.com/data'));
} catch (err) {
  // BrokenCircuitError if circuit is open
}
```

## Combining Policies
```typescript
import { retry, handleAll, wrap, ExponentialBackoff } from 'cockatiel';

const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff(),
});

// Retry inside circuit breaker
const resilientPolicy = wrap(breaker, retryPolicy);

const data = await resilientPolicy.execute(async () => {
  const res = await fetch('https://api.example.com/data');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});
```

## Bulkhead Pattern
Limit concurrent requests to prevent resource exhaustion.

```typescript
import { BulkheadPolicy } from 'cockatiel';

const bulkhead = new BulkheadPolicy(10, 50); // 10 concurrent, 50 queued
await bulkhead.execute(() => fetch(url));
```

## Timeout Policy
```typescript
import { TimeoutPolicy, TimeoutStrategy } from 'cockatiel';

const timeout = new TimeoutPolicy(5000, TimeoutStrategy.Aggressive);
await timeout.execute(async ({ signal }) => {
  return fetch(url, { signal });
});
```

## When to Use Circuit Breakers
- External API calls that may become unavailable
- Database connections that may timeout under load
- Microservice-to-microservice communication
- Any dependency where failure is possible and fast-fail is preferred

## Best Practices
- Set thresholds based on observed failure patterns
- Log state transitions (open/half-open/close) for monitoring
- Provide fallback responses when the circuit is open
- Combine with retry (inside) and timeout (outside) for comprehensive resilience
- Monitor circuit breaker metrics alongside service health
