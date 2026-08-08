---
name: wikipedia-lookup
description: Wikipedia article lookup, summary extraction, and fact verification
trigger_patterns:
  - "wikipedia"
  - "what is"
  - "define"
  - "encyclopedia"
  - "wiki lookup"
capabilities:
  - article-lookup
  - summary-extraction
  - fact-checking
version: "1.0.0"
sources:
  - name: wikipedia
    url: https://github.com/dopecodez/Wikipedia
    license: MIT
---
# Wikipedia Lookup

## Usage Patterns

### Quick Definition
- Search for the term on Wikipedia
- Extract the first paragraph for a concise definition
- Include the Wikipedia URL for reference

### Detailed Research
- Read the full article summary (first section)
- Check the "See also" section for related topics
- Follow references for primary sources
- Check the article's talk page for disputed claims

## API Integration
The `wikipedia` npm package provides programmatic access:
- `wiki.search(query)` — search for articles
- `wiki.page(title)` — get a specific page
- `page.summary()` — get the summary text
- `page.content()` — get full article content
- `page.references()` — get source references
- `page.links()` — get linked articles
- `page.images()` — get article images

## Best Practices
- Always cite Wikipedia as a secondary source, not primary
- Cross-reference important facts with primary sources
- Check the article's quality rating (Featured, Good, Start, Stub)
- Be aware of potential bias in controversial topics
- Use specific language editions for localized information (hu.wikipedia.org for Hungarian)

## Limitations
- Wikipedia content can change at any time
- Not all articles are equally well-maintained
- Technical articles may lag behind latest developments
- Some topics have limited coverage
- Vandalism is usually caught quickly but may exist temporarily

## Integration Notes
- Cache responses to avoid redundant API calls
- Respect rate limits (no more than 200 requests/second)
- Include proper User-Agent header as per Wikimedia policy
- Handle disambiguation pages gracefully
