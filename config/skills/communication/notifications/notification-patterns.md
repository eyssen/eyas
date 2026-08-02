---
name: notification-patterns
description: Notification system design — channels, preferences, and delivery patterns
trigger_patterns:
  - "notification system"
  - "notification design"
  - "notification preferences"
  - "multi-channel notification"
capabilities:
  - communication
version: "1.0.0"
---
# Notification Patterns

## Multi-Channel Architecture
```
[Event] → [Notification Service] → [Channel Router] → [Channels]
                                        ├── In-app (WebSocket)
                                        ├── Push (web-push)
                                        ├── Email (SMTP)
                                        ├── Telegram (bot API)
                                        └── Slack (webhook)
```

## Notification Model
```typescript
interface Notification {
  id: string;
  userId: string;
  type: string;            // 'task.completed', 'mention', 'system.alert'
  title: string;
  body: string;
  data: Record<string, unknown>;  // action URL, entity IDs
  channels: string[];      // ['in-app', 'push', 'email']
  priority: 'low' | 'normal' | 'high' | 'urgent';
  readAt: string | null;
  createdAt: string;
}
```

## User Preferences
```typescript
interface NotificationPreferences {
  userId: string;
  channels: {
    inApp: boolean;
    push: boolean;
    email: boolean;
    telegram: boolean;
  };
  quiet: {
    enabled: boolean;
    from: string;  // "22:00"
    to: string;    // "08:00"
    timezone: string;
  };
  byType: Record<string, {
    enabled: boolean;
    channels: string[];
  }>;
}
```

## Delivery Patterns

### Fan-Out
Send to all configured channels simultaneously.

### Escalation
Start with the least intrusive channel, escalate if unacknowledged.
```
In-app → (5 min) → Push → (15 min) → Email → (30 min) → SMS
```

### Batching
Group related notifications to reduce noise.
```typescript
// Instead of 10 separate "new comment" notifications:
// "5 new comments on Task #42"
```

### Deduplication
Prevent sending the same notification multiple times within a window.

## Priority Handling
| Priority | Behavior |
|----------|----------|
| Low | Batch, in-app only |
| Normal | In-app + push (respect quiet hours) |
| High | All channels (respect quiet hours) |
| Urgent | All channels (ignore quiet hours) |

## In-App Notifications
```typescript
// WebSocket delivery
ws.send(JSON.stringify({
  type: 'notification',
  payload: {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt,
  },
}));
```

## Best Practices
- Default to opt-in for non-essential notifications
- Provide granular control per notification type and channel
- Implement quiet hours with timezone awareness
- Batch low-priority notifications (digest emails)
- Track delivery and open rates per channel
- Allow one-click unsubscribe from email notifications
- Log all notifications for audit and debugging
- Rate limit notifications per user to prevent flooding
