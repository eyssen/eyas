---
name: seo-basics
description: Search engine optimization fundamentals for web applications
trigger_patterns:
  - "seo"
  - "search engine"
  - "meta tags"
  - "sitemap"
  - "structured data"
capabilities:
  - web
version: "1.0.0"
---
# SEO Basics

## Essential Meta Tags
```html
<head>
  <title>Page Title — Site Name</title>
  <meta name="description" content="Concise page description (150-160 chars)">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/page">

  <!-- Open Graph (Facebook, LinkedIn) -->
  <meta property="og:title" content="Page Title">
  <meta property="og:description" content="Description">
  <meta property="og:image" content="https://example.com/image.jpg">
  <meta property="og:url" content="https://example.com/page">
  <meta property="og:type" content="website">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Page Title">
  <meta name="twitter:description" content="Description">
  <meta name="twitter:image" content="https://example.com/image.jpg">
</head>
```

## Structured Data (JSON-LD)
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Article Title",
  "author": { "@type": "Person", "name": "Author Name" },
  "datePublished": "2026-01-15",
  "image": "https://example.com/image.jpg"
}
</script>
```

## Technical SEO
- Serve HTML with proper HTTP status codes (200, 301, 404)
- Use semantic HTML (h1-h6 hierarchy, nav, main, article)
- Ensure fast page load (Core Web Vitals: LCP, FID, CLS)
- Implement canonical URLs to avoid duplicate content
- Create and submit XML sitemap to search engines

## Sitemap
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-01-15</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

## robots.txt
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
```

## Best Practices
- One H1 per page, descriptive and keyword-rich
- Unique title and description for every page
- Use descriptive URLs (`/blog/seo-guide` not `/page?id=42`)
- Internal linking between related pages
- Optimize images: compress, use descriptive filenames and alt text
- HTTPS is a ranking factor — always use TLS
