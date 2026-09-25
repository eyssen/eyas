---
name: web-performance
description: Web performance optimization — Core Web Vitals, caching, and loading strategies
trigger_patterns:
  - "web performance"
  - "page speed"
  - "core web vitals"
  - "lazy loading"
  - "bundle size"
capabilities:
  - web
version: "1.0.0"
---
# Web Performance

## Core Web Vitals
- **LCP (Largest Contentful Paint)**: < 2.5s — how fast the main content loads
- **INP (Interaction to Next Paint)**: < 200ms — how responsive to user input
- **CLS (Cumulative Layout Shift)**: < 0.1 — visual stability during loading

## Loading Strategies

### Code Splitting
```typescript
// React lazy loading
const Settings = React.lazy(() => import('./pages/Settings'));

// Route-based splitting with TanStack Router
const route = createRoute({
  component: () => import('./pages/Dashboard'),
});
```

### Resource Hints
```html
<link rel="preconnect" href="https://api.example.com">
<link rel="preload" href="/fonts/inter.woff2" as="font" crossorigin>
<link rel="prefetch" href="/next-page.js">
```

### Image Optimization
```html
<img src="hero.webp" width="1200" height="600" alt="Hero"
     loading="lazy" decoding="async"
     srcset="hero-400.webp 400w, hero-800.webp 800w, hero-1200.webp 1200w"
     sizes="100vw">
```

## Caching
```
# HTTP caching headers
Cache-Control: public, max-age=31536000, immutable  # hashed assets
Cache-Control: no-cache                              # HTML (revalidate)
ETag: "abc123"                                       # conditional requests
```

## Bundle Optimization
- Tree shaking: import only what you use (`import { Button } from 'ui'`)
- Analyze bundle: `npx vite-bundle-visualizer`
- Externalize large dependencies that change rarely
- Use dynamic imports for code only needed on interaction

## Runtime Performance
- Avoid layout thrashing (batch DOM reads before writes)
- Use `requestAnimationFrame` for visual updates
- Debounce/throttle event handlers (scroll, resize, input)
- Use `will-change` sparingly for GPU-accelerated animations
- Virtualize long lists (render only visible items)

## Monitoring
- Lighthouse CI in pipeline for regression detection
- Real User Monitoring (RUM) for field data
- Set performance budgets: max bundle size, max LCP

## Best Practices
- Serve static assets from CDN with long cache TTL
- Compress with Brotli (preferred) or gzip
- Minimize render-blocking resources (CSS in head, JS deferred)
- Set explicit width/height on images and iframes to prevent CLS
- Profile before optimizing — measure, do not guess
