---
name: rate-limiting
description: API rate limiting strategies — token bucket, sliding window, and headers
trigger_patterns:
  - "rate limit"
  - "throttle"
  - "token bucket"
  - "sliding window"
  - "api quota"
capabilities:
  - api-access
version: "1.0.0"
---
# API Rate Limiting

## Algorithms
- **Fixed window** — count requests per time window (simple but bursty at edges)
- **Sliding window** — weighted count across window boundary (smoother)
- **Token bucket** — tokens replenish at fixed rate, request consumes one (allows bursts up to bucket size)
- **Leaky bucket** — requests queue and process at fixed rate (smoothest)

## Implementation (In-Memory)
```typescript
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

function rateLimit(key: string, maxTokens: number, refillRate: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key) ?? { tokens: maxTokens, lastRefill: now };

  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;  // rate limited
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
```

## Response Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1700000000
Retry-After: 30
```

## Rate Limit Response
```json
{ "error": "RATE_LIMITED", "message": "Too many requests", "retryAfter": 30 }
```
Status: `429 Too Many Requests`

## Best Practices
- Rate limit by user/API key, not just IP (NAT makes IP unreliable)
- Different limits per endpoint (login stricter than read)
- Return `Retry-After` header so clients can back off
- Use distributed store (Redis) for multi-instance deployments
- Exempt health check and monitoring endpoints
- Log rate limit events for abuse detection
