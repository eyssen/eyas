---
name: embedding-models
description: Embedding model selection, usage patterns, and optimization
trigger_patterns:
  - "embedding"
  - "vector embedding"
  - "embedding model"
  - "text-embedding"
  - "sentence embedding"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Vercel AI SDK
    url: https://github.com/vercel/ai
    license: MIT
---
# Embedding Models

## Using AI SDK for Embeddings
```typescript
import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

// Single embedding
const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: 'What is the meaning of life?',
});

// Batch embedding
const { embeddings } = await embedMany({
  model: openai.embedding('text-embedding-3-small'),
  values: chunks.map(c => c.text),
});
```

## Model Comparison
| Model | Dimensions | Quality | Cost | Speed |
|-------|-----------|---------|------|-------|
| text-embedding-3-small | 1536 | Good | Low | Fast |
| text-embedding-3-large | 3072 | Best | Medium | Medium |
| Ollama (nomic-embed-text) | 768 | Good | Free | Local |
| Ollama (mxbai-embed-large) | 1024 | Better | Free | Local |

## Dimension Reduction
For storage efficiency, reduce dimensions with Matryoshka:
```typescript
const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small', { dimensions: 512 }),
  value: text,
});
```

## Cosine Similarity
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

## Best Practices
- Use the same model for indexing and querying
- Batch embeddings to reduce API calls (max 2048 texts per call)
- Cache embeddings — recompute only when source changes
- Normalize vectors before storage if using dot product similarity
- For local/private data, prefer local models (Ollama)
- Prefix queries with "search_query:" and docs with "search_document:" if model requires it
- Monitor embedding costs — batch processing is significantly cheaper
