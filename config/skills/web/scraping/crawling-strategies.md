---
name: crawling-strategies
description: Web crawling strategies — scheduling, deduplication, and depth control
trigger_patterns:
  - "crawling"
  - "web crawling"
  - "crawl strategy"
  - "sitemap"
  - "robots.txt"
capabilities:
  - web
version: "1.0.0"
---
# Crawling Strategies

## Crawl Approaches

### Breadth-First (BFS)
- Crawl all pages at depth N before going to depth N+1
- Good for discovering all pages at a given level
- Finds important pages early (usually linked from homepage)

### Depth-First (DFS)
- Follow links deeply before backtracking
- Good for single-path exploration (e.g., pagination)
- Risk of getting stuck in deep link chains

### Priority-Based
- Score pages by relevance and crawl high-priority first
- Use URL patterns, page rank, or freshness as scoring criteria
- Best for large sites where full crawl is impractical

## URL Management

### Deduplication
```typescript
// Normalize URLs before dedup
function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';                     // remove fragment
  u.searchParams.sort();           // sort query params
  return u.href.replace(/\/+$/, ''); // remove trailing slash
}
```

### URL Filtering
- Include patterns: only crawl matching URLs
- Exclude patterns: skip known non-content URLs (login, admin, API)
- Domain scope: stay within the target domain
- Depth limit: prevent crawling too deep

## Respecting robots.txt
```
User-agent: *
Disallow: /admin/
Disallow: /api/
Crawl-delay: 2
Sitemap: https://example.com/sitemap.xml
```
- Parse and respect robots.txt before crawling
- Honor `Crawl-delay` directive
- Use sitemaps for efficient discovery

## Sitemap Processing
- Parse `sitemap.xml` for a complete URL list with last-modified dates
- Use sitemap index files for large sites
- Prioritize recently modified pages for incremental crawls

## Rate Limiting
- Per-domain concurrency limits (1-3 concurrent requests)
- Minimum delay between requests to same host
- Respect HTTP 429 and Retry-After headers
- Implement exponential backoff on errors

## Incremental Crawling
- Store last-crawl timestamp per URL
- Use HTTP conditional requests (If-Modified-Since, ETag)
- Only re-crawl pages older than a freshness threshold
- Use sitemap lastmod for change detection

## Best Practices
- Always check robots.txt and terms of service
- Set a descriptive User-Agent with contact information
- Monitor crawl health: success rate, new pages discovered, errors
- Store raw responses for re-processing without re-crawling
- Implement graceful shutdown — persist queue state for resume
