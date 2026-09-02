---
name: websocket-patterns
description: WebSocket connection management, messaging patterns, and reconnection
trigger_patterns:
  - "websocket"
  - "ws connection"
  - "real-time"
  - "socket"
  - "bidirectional"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: ws
    url: https://github.com/websockets/ws
    license: MIT
---
# WebSocket Patterns

## Server Setup (Bun native)
```typescript
Bun.serve({
  fetch(req, server) {
    if (server.upgrade(req, { data: { userId: getUserId(req) } })) return;
    return new Response('Not found', { status: 404 });
  },
  websocket: {
    open(ws) { connections.set(ws.data.userId, ws); },
    message(ws, msg) { handleMessage(ws, JSON.parse(msg as string)); },
    close(ws) { connections.delete(ws.data.userId); },
  },
});
```

## Message Protocol
```typescript
interface WsMessage {
  type: string;       // e.g., "subscribe", "event", "ping"
  channel?: string;   // topic or room
  payload?: unknown;
  id?: string;        // for request/response correlation
}
```

## Pub/Sub Channels
```typescript
const channels = new Map<string, Set<WebSocket>>();

function subscribe(ws: WebSocket, channel: string) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel)!.add(ws);
}

function broadcast(channel: string, payload: unknown) {
  for (const ws of channels.get(channel) ?? []) {
    ws.send(JSON.stringify({ type: 'event', channel, payload }));
  }
}
```

## Client Reconnection
```typescript
function createSocket(url: string, maxRetries = 5) {
  let retries = 0;
  function connect() {
    const ws = new WebSocket(url);
    ws.onopen = () => { retries = 0; };
    ws.onclose = () => {
      if (retries < maxRetries) {
        setTimeout(connect, Math.min(1000 * 2 ** retries++, 30000));
      }
    };
    return ws;
  }
  return connect();
}
```

## Best Practices
- Always implement heartbeat (ping/pong) to detect stale connections
- Use JSON with a `type` field for message routing
- Authenticate on upgrade, not after connection
- Set max message size and rate limits
- Clean up subscriptions on disconnect
