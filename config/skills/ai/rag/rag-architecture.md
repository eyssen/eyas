---
name: rag-architecture
description: Retrieval-Augmented Generation architecture and implementation patterns
trigger_patterns:
  - "rag"
  - "retrieval augmented"
  - "knowledge base"
  - "context retrieval"
  - "rag pipeline"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: LangChain.js
    url: https://github.com/langchain-ai/langchainjs
    license: MIT
---
# RAG Architecture

## Pipeline Overview
```
Query → Embed → Retrieve → Rerank → Augment Prompt → Generate → Response
```

## Core Components
1. **Document Loader** — ingest from files, APIs, databases
2. **Chunker** — split documents into retrievable segments
3. **Embedder** — convert chunks to vector representations
4. **Vector Store** — index and search vectors by similarity
5. **Retriever** — find relevant chunks for a query
6. **Reranker** — reorder results by relevance
7. **Generator** — LLM produces answer using retrieved context

## Implementation Pattern
```typescript
async function ragQuery(query: string): Promise<string> {
  // 1. Embed the query
  const queryVector = await embedder.embed(query);

  // 2. Retrieve relevant chunks
  const chunks = await vectorStore.search(queryVector, { limit: 10 });

  // 3. Rerank by relevance
  const ranked = await reranker.rerank(query, chunks, { topK: 5 });

  // 4. Build context-augmented prompt
  const context = ranked.map(c => c.text).join('\n---\n');
  const prompt = `Answer based on the following context:\n\n${context}\n\nQuestion: ${query}`;

  // 5. Generate
  return llm.generate(prompt);
}
```

## Quality Metrics
- **Retrieval recall** — did we find the relevant chunks?
- **Answer faithfulness** — does the answer match the retrieved context?
- **Answer relevance** — does it actually answer the question?
- **Hallucination rate** — claims not supported by context

## Common Issues
- Chunks too large → irrelevant context dilutes answer
- Chunks too small → missing context, incomplete answers
- Poor embedding model → low retrieval quality
- No reranking → noise in top results
- Missing metadata → cannot filter by source, date, type

## Best Practices
- Use hybrid search (vector + keyword) for better recall
- Include source citations in responses
- Add metadata filters (date range, document type)
- Monitor retrieval quality with ground-truth test sets
- Cache embeddings — recompute only on document change
