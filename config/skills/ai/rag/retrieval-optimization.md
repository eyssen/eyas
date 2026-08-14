---
name: retrieval-optimization
description: RAG retrieval optimization — reranking, filtering, and query expansion
trigger_patterns:
  - "retrieval optimization"
  - "reranking"
  - "search quality"
  - "retrieval recall"
  - "query expansion"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Orama
    url: https://github.com/askorama/orama
    license: Apache-2.0
---
# Retrieval Optimization

## Query Expansion
Transform user query for better retrieval:
```typescript
async function expandQuery(query: string): Promise<string[]> {
  const expanded = await llm.generate(
    `Generate 3 alternative phrasings for this search query. Return as JSON array.\nQuery: "${query}"`
  );
  return [query, ...JSON.parse(expanded)];
}

// Search with all variants, deduplicate results
const allResults = await Promise.all(variants.map(q => search(q)));
const unique = deduplicateByDocId(allResults.flat());
```

## Metadata Filtering
Filter before vector search to reduce noise:
```typescript
const results = await vectorStore.search(queryVector, {
  limit: 10,
  filter: {
    source: 'documentation',
    updatedAfter: '2025-01-01',
    language: 'en',
  },
});
```

## Reranking
Reorder initial results by semantic relevance:
```typescript
async function rerank(query: string, documents: Document[]): Promise<Document[]> {
  const scored = await Promise.all(
    documents.map(async (doc) => ({
      doc,
      score: await crossEncoder.score(query, doc.text),
    }))
  );
  return scored.sort((a, b) => b.score - a.score).map(s => s.doc);
}
```

## Hybrid Search with Orama
```typescript
const results = await search(db, {
  term: query,        // BM25 keyword search
  vector: {
    value: queryEmbedding,
    property: 'embedding',
  },
  hybrid: true,       // combine keyword + vector scores
  limit: 10,
});
```

## Context Window Optimization
- Retrieve more, then prune: fetch 20, rerank, use top 5
- Order by relevance: most relevant chunk first in prompt
- Summarize long chunks before including in context
- Include source metadata for citation

## Evaluation Metrics
- **Recall@K** — fraction of relevant docs in top K results
- **MRR** — mean reciprocal rank of first relevant result
- **NDCG** — normalized discounted cumulative gain
- Build a test set of (query, relevant_doc_ids) pairs
- Evaluate after every pipeline change
