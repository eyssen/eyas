---
name: webhook-handling
description: Webhook receiving, verification, and processing patterns
trigger_patterns:
  - "webhook"
  - "webhook handler"
  - "webhook verification"
  - "incoming webhook"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: Hono
    url: https://github.com/honojs/hono
    license: MIT
---
# Webhook Handling

## Receiving Webhooks (Hono)
```typescript
import { Hono } from 'hono';

const app = new Hono();

app.post('/webhooks/:provider', async (c) => {
  const provider = c.req.param('provider');
  const body = await c.req.json();

  // Verify signature
  const signature = c.req.header('x-signature');
  if (!verifySignature(provider, body, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Process asynchronously
  processWebhook(provider, body).catch(err => {
    console.error('Webhook processing failed:', err);
  });

  // Respond quickly (within 5 seconds)
  return c.json({ received: true }, 200);
});
```

## Signature Verification
```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm = 'sha256'
): boolean {
  const expected = createHmac(algorithm, secret).update(payload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const signatureBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
```

## Common Webhook Providers
| Provider | Signature Header | Algorithm |
|----------|-----------------|-----------|
| GitHub | `x-hub-signature-256` | HMAC-SHA256 |
| Stripe | `stripe-signature` | HMAC-SHA256 (with timestamp) |
| Slack | `x-slack-signature` | HMAC-SHA256 (with timestamp) |
| Telegram | (IP whitelist) | N/A |

## Idempotency
```typescript
async function processWebhook(provider: string, event: WebhookEvent) {
  // Check if already processed
  const existing = await db.select()
    .from(webhookLog)
    .where(eq(webhookLog.eventId, event.id));

  if (existing.length > 0) {
    console.log(`Duplicate webhook: ${event.id}`);
    return;
  }

  // Process and log
  await db.insert(webhookLog).values({
    eventId: event.id,
    provider,
    payload: event,
    processedAt: new Date().toISOString(),
  });

  // Handle the event
  await handleEvent(event);
}
```

## Best Practices
- Always verify webhook signatures — never trust unverified payloads
- Respond with 200 quickly, process asynchronously
- Implement idempotency — webhooks may be delivered multiple times
- Log all incoming webhooks for debugging and audit
- Use a queue for reliable processing with retry
- Set up monitoring for webhook delivery failures
- Handle webhook provider IP allowlisting where supported
