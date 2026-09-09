---
name: pwa
description: Progressive Web App concepts — service workers, manifest, and offline support
trigger_patterns:
  - "pwa"
  - "progressive web app"
  - "service worker"
  - "offline"
  - "web manifest"
capabilities:
  - web
version: "1.0.0"
---
# Progressive Web Apps

## Web App Manifest
```json
{
  "name": "EYAS Assistant",
  "short_name": "EYAS",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a1a2e",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1a1a2e">
```

## Service Worker Registration
```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.error('SW registration failed:', err));
}
```

## Caching Strategies

### Cache First (static assets)
```typescript
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open('static-v1').then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
```

### Network First (API data)
Fetch from network, fall back to cache if offline.

### Stale While Revalidate
Return cached version immediately, update cache in background.

## Offline Support
- Cache the app shell (HTML, CSS, JS) for offline loading
- Show offline-specific UI when network is unavailable
- Queue failed requests and retry when back online
- Use IndexedDB for structured offline data storage

## Install Prompt
```typescript
let deferredPrompt: BeforeInstallPromptEvent;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show custom install button
});

installButton.addEventListener('click', () => {
  deferredPrompt.prompt();
});
```

## Best Practices
- Use HTTPS (required for service workers)
- Implement cache versioning — update cache name on deploy
- Clean up old caches in the `activate` event
- Test offline behavior with browser DevTools Network tab
- Keep the service worker simple — complex logic should be in the app
- Use Workbox for production service worker tooling
