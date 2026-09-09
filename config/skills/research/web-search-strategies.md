---
name: web-search-strategies
description: Effective web search techniques and query optimization strategies
trigger_patterns:
  - "search for"
  - "find information"
  - "web search"
  - "look up"
  - "google"
capabilities:
  - query-optimization
  - source-evaluation
  - search-techniques
version: "1.0.0"
---
# Web Search Strategies

## Query Optimization
- Use specific keywords rather than natural language questions
- Enclose exact phrases in quotes: `"dependency injection pattern"`
- Use minus to exclude: `python web framework -django`
- Use site: to restrict domain: `site:github.com drizzle orm`
- Use filetype: for specific formats: `filetype:pdf architecture patterns`
- Combine operators: `"rate limiting" site:stackoverflow.com -nginx`

## Search Approach by Goal

### Finding Code Examples
- Search: `[language] [library] [task] example`
- Prefer GitHub, Stack Overflow, official docs
- Check dates — old answers may use deprecated APIs

### Finding Documentation
- Search: `[library] [version] [feature] docs`
- Go directly to official docs first
- Check changelog/migration guides for version-specific info

### Debugging Errors
- Search the exact error message in quotes
- Include the library version in the query
- Check GitHub Issues for the project

### Research and Learning
- Start broad, then narrow down
- Use "vs" for comparisons: `redis vs memcached`
- Look for "awesome-X" lists on GitHub for curated resources
- Check recent conference talks and blog posts

## Source Quality Assessment
- Official documentation > blog posts > forum answers
- Recent content > old content (especially for fast-moving tech)
- Multiple sources agreeing > single source
- Check author credentials and publication venue
- Beware of AI-generated content without verification

## When to Stop Searching
- You have found 2-3 independent sources confirming the same answer
- Official documentation clearly addresses the question
- The search is taking longer than implementing a quick test
- Diminishing returns — same results appearing repeatedly
