---
name: websocket-patterns
description: WebSocket server and client patterns with ws
trigger_patterns:
  - "websocket"
  - "ws"
  - "realtime"
  - "socket"
  - "bidirectional"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: ws
    url: https://github.com/websockets/ws
    license: MIT
---
# WebSocket Patterns

## Server with ws
```typescript
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  console.log(`Client connected: ${clientId}`);

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    handleMessage(ws, clientId, message);
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error: ${err.message}`);
  });
});
```

## Message Protocol
```typescript
interface WsMessage {
  type: string;
  payload: unknown;
  id?: string;       // for request-response correlation
  timestamp: number;
}

function send(ws: WebSocket, type: string, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
  }
}
```

## Broadcasting
```typescript
function broadcast(wss: WebSocketServer, type: string, payload: unknown, exclude?: WebSocket) {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
```

## Room/Channel Pattern
```typescript
const rooms = new Map<string, Set<WebSocket>>();

function joinRoom(ws: WebSocket, room: string) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room)!.add(ws);
}

function broadcastToRoom(room: string, message: string) {
  for (const client of rooms.get(room) ?? []) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
```

## Heartbeat / Keep-Alive
```typescript
const HEARTBEAT_INTERVAL = 30000;

wss.on('connection', (ws) => {
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!(ws as any).isAlive) return ws.terminate();
    (ws as any).isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL);
```

## Best Practices
- Always validate incoming messages (Zod schema)
- Implement heartbeat to detect dead connections
- Use binary frames (ArrayBuffer) for large data transfers
- Authenticate on connection (token in query string or first message)
- Set per-client message rate limits to prevent abuse
- Handle reconnection logic on the client side with exponential backoff
