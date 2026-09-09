---
name: agent-communication
description: Inter-agent communication patterns and message protocols in EYAS
trigger_patterns:
  - "agent communication"
  - "agent message"
  - "agent protocol"
  - "agent to agent"
capabilities:
  - message-routing
  - protocol-design
  - event-patterns
version: "1.0.0"
---
# Agent Communication

## Communication Patterns

### Direct Messaging
- Agent A sends a message directly to Agent B
- Synchronous: A waits for B's response
- Asynchronous: A continues, gets notified when B responds
- Use for: specific task delegation, question-answer

### Event Bus (Pub/Sub)
- Agents publish events to topics
- Other agents subscribe to topics of interest
- Decoupled: publisher doesn't know who listens
- Use for: status updates, notifications, cross-cutting concerns

### Request/Response
- Agent sends a request with expected response format
- Timeout handling for unresponsive agents
- Retry logic for transient failures
- Use for: data queries, action confirmations

### Broadcast
- One agent sends to all active agents
- Use sparingly — can cause noise
- Use for: system-wide announcements, configuration changes

## Message Structure
```typescript
interface AgentMessage {
  id: string;              // Unique message ID
  from: string;            // Sender agent ID
  to: string | 'broadcast'; // Recipient or broadcast
  type: 'request' | 'response' | 'event' | 'notification';
  topic: string;           // Message category
  payload: unknown;        // Message content
  replyTo?: string;        // For responses: original message ID
  timestamp: string;       // ISO 8601
  priority: 'low' | 'normal' | 'high' | 'urgent';
}
```

## Routing Rules
- Messages routed by agent ID or topic subscription
- Priority queue for urgent messages
- Dead letter queue for undeliverable messages
- Message deduplication by ID

## Error Handling
- Timeout: configurable per message type (default 30s)
- Retry: exponential backoff, max 3 attempts
- Circuit breaker: stop sending to a consistently failing agent
- Fallback: route to alternative agent if primary is unavailable

## Best Practices
- Keep messages small — reference large data by ID, don't embed
- Include correlation IDs for tracing message chains
- Log all inter-agent communication for debugging
- Version message schemas to allow gradual migration
- Design for eventual consistency — agents may have stale data
