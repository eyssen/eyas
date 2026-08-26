---
name: rss-parsing
description: RSS and Atom feed parsing with rss-parser
trigger_patterns:
  - "rss"
  - "parse rss"
  - "atom feed"
  - "rss feed"
  - "feed reader"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: rss-parser
    url: https://github.com/rbren/rss-parser
    license: MIT
---
# RSS Feed Parsing

## Basic Usage
```typescript
import Parser from 'rss-parser';

const parser = new Parser();

const feed = await parser.parseURL('https://example.com/feed.xml');
console.log(feed.title);       // "Example Blog"
console.log(feed.description); // "Latest articles"

for (const item of feed.items) {
  console.log(item.title);       // article title
  console.log(item.link);        // article URL
  console.log(item.pubDate);     // publication date string
  console.log(item.content);     // full content (if available)
  console.log(item.contentSnippet); // text-only snippet
}
```

## Custom Fields
```typescript
const parser = new Parser({
  customFields: {
    feed: ['language', 'copyright'],
    item: [
      ['media:content', 'media'],
      ['dc:creator', 'creator'],
    ],
  },
});
```

## Parsing from String
```typescript
const feed = await parser.parseString(xmlString);
```

## Feed Types
- **RSS 2.0**: most common, `<rss version="2.0">`
- **Atom**: `<feed xmlns="http://www.w3.org/2005/Atom">`
- **RSS 1.0**: older RDF-based format
- rss-parser handles all three transparently

## Building a Feed Aggregator
```typescript
interface FeedSource {
  url: string;
  name: string;
  lastFetched?: string;
}

async function fetchNewItems(source: FeedSource) {
  const feed = await parser.parseURL(source.url);
  const newItems = feed.items.filter(item => {
    const pubDate = new Date(item.pubDate || 0);
    return pubDate > new Date(source.lastFetched || 0);
  });
  return newItems;
}
```

## Best Practices
- Cache feed responses with ETags and Last-Modified headers
- Respect feed update frequency (check `ttl` or `sy:updatePeriod`)
- Handle feed parsing errors gracefully (malformed XML is common)
- Normalize dates from different feed formats
- Store the raw feed response for debugging
- Set request timeouts — some feeds are slow to respond
