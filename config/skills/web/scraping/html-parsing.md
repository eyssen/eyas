---
name: html-parsing
description: Server-side HTML parsing and data extraction with cheerio
trigger_patterns:
  - "html parsing"
  - "parse html"
  - "extract data html"
  - "cheerio"
  - "scrape html"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: cheerio
    url: https://github.com/cheeriojs/cheerio
    license: MIT
---
# HTML Parsing

## Loading HTML with Cheerio
```typescript
import * as cheerio from 'cheerio';

const $ = cheerio.load(htmlString);
```

## Selecting Elements
```typescript
// CSS selectors
const titles = $('h1, h2, h3').map((i, el) => $(el).text()).get();
const links = $('a[href]').map((i, el) => ({
  text: $(el).text().trim(),
  href: $(el).attr('href'),
})).get();

// Nested selection
$('table tbody tr').each((i, row) => {
  const cells = $(row).find('td').map((j, cell) => $(cell).text().trim()).get();
});
```

## Data Extraction Patterns

### Structured Data from Tables
```typescript
function parseTable($: cheerio.CheerioAPI, selector: string) {
  const headers = $(`${selector} thead th`).map((i, el) => $(el).text().trim()).get();
  const rows = $(`${selector} tbody tr`).map((i, row) => {
    const cells = $(row).find('td').map((j, cell) => $(cell).text().trim()).get();
    return Object.fromEntries(headers.map((h, idx) => [h, cells[idx]]));
  }).get();
  return rows;
}
```

### Metadata Extraction
```typescript
const meta = {
  title: $('title').text(),
  description: $('meta[name="description"]').attr('content'),
  ogImage: $('meta[property="og:image"]').attr('content'),
  canonical: $('link[rel="canonical"]').attr('href'),
};
```

### JSON-LD Structured Data
```typescript
const jsonLd = $('script[type="application/ld+json"]')
  .map((i, el) => JSON.parse($(el).html() || '{}'))
  .get();
```

## URL Resolution
```typescript
// Resolve relative URLs to absolute
const baseUrl = 'https://example.com';
const absoluteLinks = $('a[href]').map((i, el) => {
  const href = $(el).attr('href');
  return new URL(href!, baseUrl).href;
}).get();
```

## Best Practices
- Validate selectors against sample pages before running at scale
- Handle missing elements gracefully (check length before accessing)
- Normalize whitespace in extracted text (trim, collapse spaces)
- Cache parsed DOM if running multiple extractions on the same page
- Use specific selectors (class/id) over generic ones (tag name) for stability
