---
name: retry-strategies
description: HTTP retry patterns with p-retry and exponential backoff
trigger_patterns:
  - "retry"
  - "exponential backoff"
  - "retry strategy"
  - "p-retry"
  - "rate limit"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: p-retry
    url: https://github.com/sindresorhus/p-retry
    license: MIT
---
# Retry Strategies

## p-retry
```typescript
import pRetry, { AbortError } from 'p-retry';

const data = await pRetry(
  async () => {
    const response = await fetch('https://api.example.com/data');

    if (response.status === 404) {
      throw new AbortError('Resource not found'); // do not retry
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`); // will retry
    }

    return response.json();
  },
  {
    retries: 3,
    minTimeout: 1000,     // 1s initial delay
    maxTimeout: 10000,    // 10s max delay
    factor: 2,            // exponential factor
    onFailedAttempt: (error) => {
      console.log(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
    },
  }
);
```

## Exponential Backoff with Jitter
```typescript
function getBackoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = Math.random() * exponential * 0.5; // 0-50% jitter
  return exponential + jitter;
}
```

## Which Errors to Retry
**Retry:**
- Network errors (connection refused, timeout, DNS failure)
- HTTP 408 (Request Timeout)
- HTTP 429 (Too Many Requests) — respect `Retry-After` header
- HTTP 500, 502, 503, 504 (server errors)

**Do NOT retry:**
- HTTP 400 (Bad Request) — fix the request
- HTTP 401/403 (Auth errors) — re-authenticate first
- HTTP 404 (Not Found) — resource does not exist
- HTTP 409 (Conflict) — resolve conflict first

## Rate Limit Handling
```typescript
async function fetchWithRateLimit(url: string): Promise<Response> {
  const response = await fetch(url);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return fetchWithRateLimit(url); // retry after waiting
  }

  return response;
}
```

## Best Practices
- Always set a maximum number of retries (3-5 for most cases)
- Use jitter to prevent thundering herd when many clients retry simultaneously
- Log each retry attempt with context for debugging
- Set a total timeout budget across all retries
- Make retried operations idempotent to avoid duplicate side effects
- Use `AbortError` to signal non-retryable failures
