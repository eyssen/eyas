---
name: feed-aggregation
description: Feed aggregation patterns — polling, deduplication, and content normalization
trigger_patterns:
  - "feed aggregation"
  - "aggregate feeds"
  - "news aggregator"
  - "feed collection"
capabilities:
  - communication
version: "1.0.0"
---
# Feed Aggregation

## Architecture
```
[Feed Sources] → [Poller] → [Parser] → [Normalizer] → [Deduplicator] → [Storage] → [API/UI]
```

## Polling Strategy
```typescript
interface FeedSubscription {
  id: string;
  url: string;
  pollIntervalMinutes: number;
  lastPolledAt: string | null;
  etag: string | null;
  lastModified: string | null;
}

async function pollFeed(sub: FeedSubscription): Promise<FeedItem[]> {
  const headers: Record<string, string> = {};
  if (sub.etag) headers['If-None-Match'] = sub.etag;
  if (sub.lastModified) headers['If-Modified-Since'] = sub.lastModified;

  const response = await fetch(sub.url, { headers });
  if (response.status === 304) return []; // not modified

  const xml = await response.text();
  const feed = await parser.parseString(xml);

  // Update cache headers
  sub.etag = response.headers.get('etag');
  sub.lastModified = response.headers.get('last-modified');

  return feed.items;
}
```

## Content Normalization
```typescript
interface NormalizedItem {
  sourceId: string;
  externalId: string;    // GUID or link
  title: string;
  url: string;
  content: string;       // cleaned HTML
  textContent: string;   // plain text
  publishedAt: Date;
  author: string | null;
  categories: string[];
  imageUrl: string | null;
}
```

## Deduplication
- Primary key: combination of feed source + item GUID
- Content-based: detect near-duplicates across feeds (same story from multiple sources)
- URL normalization: strip tracking parameters, resolve redirects

```typescript
function deduplicateKey(item: FeedItem): string {
  return item.guid || item.link || `${item.title}:${item.pubDate}`;
}
```

## Scheduling
- Adaptive polling: increase interval for feeds that rarely update
- Respect `ttl` and `sy:updatePeriod` from the feed
- Spread polls to avoid burst load on feed servers
- Use conditional requests (ETag, Last-Modified) to reduce bandwidth

## Content Processing
- Strip tracking pixels and analytics tags
- Extract and cache images locally
- Generate text summaries for long articles
- Detect language for multilingual aggregation
- Index content for full-text search

## Best Practices
- Use conditional HTTP requests to minimize bandwidth
- Handle feed errors gracefully (retry with backoff, disable after repeated failures)
- Store raw feed items for re-processing
- Implement rate limiting per feed host
- Provide unread/read tracking per user
- Set a maximum age for cleanup (e.g., remove items older than 30 days)
