---
name: web-scraping
description: Web scraping at scale with Crawlee
trigger_patterns:
  - "web scraping"
  - "crawlee"
  - "scrape website"
  - "data extraction"
  - "web crawler"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: crawlee
    url: https://github.com/apify/crawlee
    license: Apache-2.0
---
# Web Scraping with Crawlee

## HTTP-based Scraping (Fast)
```typescript
import { CheerioCrawler } from 'crawlee';

const crawler = new CheerioCrawler({
  maxConcurrency: 5,
  maxRequestsPerMinute: 60,
  requestHandler: async ({ request, $, enqueueLinks }) => {
    const title = $('h1').text();
    const content = $('article').text();

    // Store extracted data
    await Dataset.pushData({
      url: request.url,
      title,
      content,
    });

    // Follow links
    await enqueueLinks({
      globs: ['https://example.com/articles/*'],
    });
  },
});

await crawler.run(['https://example.com/articles']);
```

## Browser-based Scraping (JavaScript-rendered pages)
```typescript
import { PlaywrightCrawler } from 'crawlee';

const crawler = new PlaywrightCrawler({
  maxConcurrency: 3,
  requestHandler: async ({ page, request }) => {
    await page.waitForSelector('.content');
    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('h1')?.textContent,
        items: [...document.querySelectorAll('.item')].map(el => el.textContent),
      };
    });
  },
});
```

## Request Queue and State
- Crawlee persists the request queue — resume after crashes
- Deduplication: URLs are only crawled once by default
- Priority queue: set `request.priority` for important pages

## Rate Limiting and Politeness
- Respect `robots.txt` — check before scraping
- Set `maxRequestsPerMinute` to avoid overwhelming servers
- Add random delays between requests
- Use rotating user agents
- Implement exponential backoff on errors

## Error Handling
- Crawlee retries failed requests automatically (configurable)
- Handle HTTP 429 (rate limited) by increasing delay
- Handle HTTP 403 (blocked) by rotating proxies or user agents
- Log failed URLs for manual review

## Best Practices
- Start with CheerioCrawler (HTTP) — use Playwright only when JS rendering is needed
- Store raw HTML alongside extracted data for re-extraction
- Validate extracted data structure before storage
- Monitor scraping quality — pages may change structure over time
- Check legal terms and robots.txt before scraping any website
