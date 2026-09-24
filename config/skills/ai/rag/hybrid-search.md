---
name: hybrid-search
description: Hybrid search combining vector similarity with keyword (BM25) search
trigger_patterns:
  - "hybrid search"
  - "bm25"
  - "keyword search"
  - "full text search"
  - "vector search"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Orama
    url: https://github.com/askorama/orama
    license: Apache-2.0
---
# Hybrid Search

## Why Hybrid
- **Vector search** excels at semantic similarity ("how to fix a bug" matches "debugging techniques")
- **Keyword search** excels at exact matches (error codes, names, IDs)
- **Hybrid** combines both — best of both worlds

## Orama Hybrid Search
```typescript
import { create, insert, search } from '@orama/orama';

const db = await create({
  schema: {
    title: 'string',
    content: 'string',
    embedding: 'vector[1536]',
  },
});

// Insert with embedding
await insert(db, {
  title: 'Error Handling Guide',
  content: 'Use try-catch for expected errors...',
  embedding: await embed(content),
});

// Hybrid search
const results = await search(db, {
  term: 'try catch error',     // keyword component
  vector: {
    value: await embed('how to handle errors in TypeScript'),
    property: 'embedding',
  },
  hybrid: true,
  limit: 10,
});
```

## Score Fusion
Combine keyword and vector scores:
```typescript
// Reciprocal Rank Fusion (RRF)
function rrfScore(keywordRank: number, vectorRank: number, k = 60): number {
  return 1 / (k + keywordRank) + 1 / (k + vectorRank);
}

// Weighted combination
function weightedScore(keywordScore: number, vectorScore: number, alpha = 0.5): number {
  return alpha * keywordScore + (1 - alpha) * vectorScore;
}
```

## When to Favor Which
| Scenario | Best Approach |
|----------|--------------|
| Exact match (error codes, IDs) | Keyword heavy (alpha=0.8) |
| Conceptual questions | Vector heavy (alpha=0.3) |
| General search | Balanced (alpha=0.5) |
| Known-item search | Keyword with vector fallback |

## Best Practices
- Tune alpha based on your data and query patterns
- Use RRF when scores from different systems are not directly comparable
- Index metadata fields for keyword search (title, tags, source)
- Evaluate both components separately to understand contribution
- Boost recent documents with a time decay factor
- Faceted search: combine hybrid with metadata filters
