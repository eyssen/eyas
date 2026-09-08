---
name: caching-strategies
description: HTTP caching, ETags, cache invalidation, and CDN patterns
trigger_patterns:
  - "caching"
  - "cache control"
  - "etag"
  - "cache invalidation"
  - "cdn cache"
capabilities:
  - api-access
version: "1.0.0"
---
# API Caching Strategies

## HTTP Cache Headers
```
Cache-Control: public, max-age=3600, stale-while-revalidate=60
ETag: "abc123"
Last-Modified: Wed, 15 Jan 2025 12:00:00 GMT
Vary: Accept-Encoding, Authorization
```

## Cache-Control Directives
- `public` — cacheable by browsers and CDNs
- `private` — cacheable by browser only (user-specific data)
- `no-cache` — must revalidate before using cached copy
- `no-store` — never cache (sensitive data)
- `max-age=N` — fresh for N seconds
- `stale-while-revalidate=N` — serve stale while refreshing in background

## ETag Validation
```typescript
app.get('/api/v1/resource/:id', async (c) => {
  const data = await fetchResource(c.req.param('id'));
  const etag = generateETag(data);

  if (c.req.header('If-None-Match') === etag) {
    return new Response(null, { status: 304 });
  }
  return c.json(data, 200, { ETag: etag });
});
```

## Cache Layers
1. **Browser cache** — closest to user, HTTP headers control it
2. **CDN / Edge** — geographic distribution, long TTL for static assets
3. **Application cache** — in-memory (Map, LRU) for hot data
4. **Database cache** — query result cache, materialized views

## Invalidation Strategies
- **Time-based (TTL)** — simplest, eventual consistency
- **Event-driven** — purge on write/update events
- **Tag-based** — tag cached entries, purge by tag
- **Version in URL** — `/assets/bundle.v3.js` (static assets)

## Best Practices
- Cache public read-heavy endpoints aggressively
- Never cache authenticated mutation responses
- Use `Vary` header to prevent serving wrong cached variant
- Monitor cache hit rates — low hit rate means wrong TTL or bad key
- Set `no-store` for sensitive data (tokens, PII)
