---
name: sse-streaming
description: Server-Sent Events for real-time server-to-client streaming
trigger_patterns:
  - "sse"
  - "server sent events"
  - "event stream"
  - "streaming response"
  - "text/event-stream"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: Hono
    url: https://github.com/honojs/hono
    license: MIT
---
# Server-Sent Events (SSE)

## Server Implementation (Hono)
```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const app = new Hono();

app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    let id = 0;

    // Send events periodically
    const interval = setInterval(async () => {
      await stream.writeSSE({
        data: JSON.stringify({ time: new Date().toISOString() }),
        event: 'tick',
        id: String(id++),
      });
    }, 1000);

    // Cleanup on disconnect
    stream.onAbort(() => clearInterval(interval));
  });
});
```

## Manual SSE Response
```typescript
app.get('/events', (c) => {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      send('connected', { status: 'ok' });
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
```

## Client Implementation
```typescript
const source = new EventSource('/events');

source.addEventListener('tick', (event) => {
  const data = JSON.parse(event.data);
  console.log('Tick:', data.time);
});

source.addEventListener('error', () => {
  console.error('SSE connection lost, will auto-reconnect');
});

// Close when done
source.close();
```

## SSE Protocol Format
```
event: message
data: {"text": "Hello"}
id: 42
retry: 5000

```
- `event`: event type (optional, defaults to "message")
- `data`: payload (can be multi-line, each line prefixed with `data:`)
- `id`: event ID for reconnection (browser sends `Last-Event-ID` header)
- `retry`: reconnection delay in milliseconds

## SSE vs WebSocket
| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server → Client | Bidirectional |
| Protocol | HTTP/1.1+ | Upgrade to WS |
| Auto-reconnect | Built-in | Manual |
| Binary data | No (text only) | Yes |
| Complexity | Simple | Medium |

## Best Practices
- Use SSE for server-to-client push (notifications, progress, live data)
- Use WebSocket when you need bidirectional communication
- Set `retry` to control client reconnection interval
- Track `Last-Event-ID` for resumable streams
- Limit the number of concurrent SSE connections per client
