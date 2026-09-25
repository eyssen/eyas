---
name: rss-generation
description: Generating RSS and Atom feeds with the feed package
trigger_patterns:
  - "generate rss"
  - "create feed"
  - "rss generation"
  - "atom generation"
  - "feed output"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: feed
    url: https://github.com/jpmonette/feed
    license: MIT
---
# RSS/Atom Feed Generation

## Creating a Feed
```typescript
import { Feed } from 'feed';

const feed = new Feed({
  title: 'EYAS Updates',
  description: 'Latest updates from EYAS assistant',
  id: 'https://eyas.example.com/',
  link: 'https://eyas.example.com/',
  language: 'en',
  favicon: 'https://eyas.example.com/favicon.ico',
  copyright: `Copyright ${new Date().getFullYear()} eYssen`,
  author: {
    name: 'EYAS',
    email: 'info@example.com',
    link: 'https://example.com',
  },
});
```

## Adding Items
```typescript
feed.addItem({
  title: 'New Feature: Agent Templates',
  id: 'https://eyas.example.com/updates/agent-templates',
  link: 'https://eyas.example.com/updates/agent-templates',
  description: 'Create AI agents from pre-built templates.',
  content: '<p>Full HTML content of the update...</p>',
  date: new Date('2026-04-12'),
  author: [{ name: 'EYAS Team' }],
  category: [{ name: 'Feature' }],
  image: 'https://eyas.example.com/images/agent-templates.png',
});
```

## Output Formats
```typescript
// RSS 2.0
const rss = feed.rss2();

// Atom
const atom = feed.atom1();

// JSON Feed 1.0
const json = feed.json1();
```

## Serving Feeds (Hono)
```typescript
app.get('/feed.xml', (c) => {
  return c.body(feed.rss2(), 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/feed.atom', (c) => {
  return c.body(feed.atom1(), 200, {
    'Content-Type': 'application/atom+xml; charset=utf-8',
  });
});

app.get('/feed.json', (c) => {
  return c.body(feed.json1(), 200, {
    'Content-Type': 'application/feed+json; charset=utf-8',
  });
});
```

## HTML Discovery
```html
<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" title="Atom" href="/feed.atom">
```

## Best Practices
- Include both RSS and Atom formats for maximum compatibility
- Set appropriate cache headers (1 hour is typical)
- Include full content in the feed (not just excerpts) when possible
- Limit feed to 20-50 most recent items
- Use permanent URLs as item IDs for stability
- Add categories/tags for filtering in feed readers
