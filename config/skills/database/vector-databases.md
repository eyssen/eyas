---
name: vector-databases
description: Vector search and embedding storage with Orama
trigger_patterns:
  - "vector database"
  - "vector search"
  - "embedding"
  - "similarity search"
  - "orama"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: Orama
    url: https://github.com/askorama/orama
    license: Apache-2.0
---
# Vector Databases

## Orama — Embedded Search Engine
```typescript
import { create, insert, search } from '@orama/orama';

const db = await create({
  schema: {
    title: 'string',
    content: 'string',
    embedding: 'vector[1536]',  // dimension must match your model
  },
});

await insert(db, {
  title: 'Getting Started',
  content: 'This guide covers installation and setup.',
  embedding: [0.1, 0.2, ...],  // 1536-dimensional vector
});
```

## Vector Search
```typescript
const results = await search(db, {
  mode: 'vector',
  vector: {
    value: queryEmbedding,
    property: 'embedding',
  },
  similarity: 0.8,  // minimum similarity threshold
  limit: 10,
});
```

## Hybrid Search (Text + Vector)
```typescript
const results = await search(db, {
  mode: 'hybrid',
  term: 'installation guide',
  vector: {
    value: queryEmbedding,
    property: 'embedding',
  },
  limit: 10,
});
```

## Embedding Generation
- Use AI model providers to generate embeddings
- Common dimensions: 384 (small), 768 (medium), 1536 (OpenAI), 3072 (large)
- Normalize embeddings for cosine similarity
- Cache embeddings — regenerating is expensive

## Similarity Metrics
- **Cosine similarity**: angle between vectors (most common for text)
- **Euclidean distance**: straight-line distance (spatial data)
- **Dot product**: unnormalized cosine (faster if vectors are normalized)

## Use Cases
- Semantic search: find documents by meaning, not just keywords
- Recommendation: find similar items based on feature vectors
- RAG (Retrieval-Augmented Generation): provide context to LLMs
- Deduplication: find near-duplicate content

## Best Practices
- Choose embedding dimensions based on accuracy vs speed tradeoff
- Pre-filter with metadata before vector search for better performance
- Batch embedding generation to minimize API calls
- Store raw text alongside vectors for retrieval
- Periodically re-embed content when upgrading embedding models
