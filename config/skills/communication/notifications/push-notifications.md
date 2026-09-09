---
name: push-notifications
description: Web push notifications with web-push
trigger_patterns:
  - "push notification"
  - "web push"
  - "push api"
  - "browser notification"
  - "vapid"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: web-push
    url: https://github.com/nickolasg/web-push
    license: MIT
---
# Web Push Notifications

## Server Setup
```typescript
import webPush from 'web-push';

// Generate VAPID keys once: webPush.generateVAPIDKeys()
webPush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);
```

## Sending Notifications
```typescript
interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

async function sendPush(subscription: PushSubscription, payload: object) {
  try {
    await webPush.sendNotification(
      subscription,
      JSON.stringify(payload),
      { TTL: 3600 } // seconds
    );
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — remove from database
      await removeSubscription(subscription.endpoint);
    }
  }
}

await sendPush(userSubscription, {
  title: 'Task Completed',
  body: 'Your task "Review PR" has been completed.',
  icon: '/icon-192.png',
  url: '/board/tasks/42',
  tag: 'task-42',       // replace previous notification with same tag
});
```

## Client — Subscribe
```typescript
async function subscribeToPush(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // Send subscription to server
  await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });

  return subscription;
}
```

## Service Worker — Handle Push
```typescript
// sw.js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      tag: data.tag,
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
```

## Best Practices
- Always ask for permission with context (explain why notifications are useful)
- Use notification tags to prevent duplicate notifications
- Handle expired subscriptions (410 Gone) by removing from database
- Set appropriate TTL — stale notifications are worse than no notification
- Respect user preferences — provide granular notification settings
- Keep payload small (< 4KB) — include only essential data
