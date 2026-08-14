---
name: webhook-design
description: Webhook design, delivery guarantees, security, and retry patterns
trigger_patterns:
  - "webhook"
  - "webhook design"
  - "event delivery"
  - "callback url"
  - "webhook security"
capabilities:
  - api-access
version: "1.0.0"
---
# Webhook Design

## Webhook Payload
```json
{
  "id": "evt_abc123",
  "type": "order.created",
  "timestamp": "2025-01-15T12:00:00Z",
  "data": {
    "id": "ord_456",
    "status": "confirmed",
    "total": 99.99
  }
}
```

## Signature Verification
```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

## Delivery with Retry
```typescript
async function deliverWebhook(url: string, payload: object, secret: string) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  for (const delay of [0, 5_000, 30_000, 300_000, 3600_000]) {  // 0s, 5s, 30s, 5m, 1h
    if (delay) await sleep(delay);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
      body,
    });
    if (res.ok) return;  // 2xx = success
  }
  // Mark endpoint as failing after max retries
}
```

## Registration API
```
POST /api/v1/webhooks
{ "url": "https://client.com/hook", "events": ["order.created", "order.cancelled"] }
```

## Best Practices
- Use HMAC-SHA256 signatures — always verify on receiver side
- Include event `id` for idempotency (receiver deduplicates)
- Retry with exponential backoff (5 attempts typical)
- Timeout webhook delivery at 10 seconds
- Disable endpoints after N consecutive failures
- Provide a "test" endpoint for developers to verify setup
- Log all delivery attempts for debugging
- Send a `ping` event on registration to verify URL
