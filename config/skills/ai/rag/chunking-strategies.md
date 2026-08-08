---
name: chunking-strategies
description: Document chunking strategies for RAG — splitting, overlap, and semantic chunking
trigger_patterns:
  - "chunking"
  - "text splitting"
  - "chunk size"
  - "document splitting"
  - "chunk overlap"
capabilities:
  - ai
version: "1.0.0"
---
# Chunking Strategies

## Fixed-Size Chunking
```typescript
function fixedChunk(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
```
- Simple, predictable
- May split mid-sentence or mid-paragraph

## Recursive Character Splitting
Split by priority: paragraph → sentence → word → character:
```typescript
const separators = ['\n\n', '\n', '. ', ' ', ''];
function recursiveSplit(text: string, maxSize: number, separators: string[]): string[] {
  const sep = separators.find(s => text.includes(s)) ?? '';
  const parts = text.split(sep);
  // Merge small parts, split large parts with next separator
  return mergeAndSplit(parts, maxSize, separators.slice(1));
}
```

## Semantic Chunking
Split by meaning — keep related content together:
1. Split into sentences
2. Embed each sentence
3. Find breakpoints where cosine similarity drops
4. Group contiguous similar sentences into chunks

## Chunk Size Guidelines
| Content Type | Chunk Size | Overlap |
|-------------|-----------|---------|
| Technical docs | 500-1000 tokens | 100 tokens |
| Conversational | 200-500 tokens | 50 tokens |
| Code | Function/class level | Include signature |
| Legal/medical | 300-600 tokens | 150 tokens |

## Metadata Enrichment
Always attach metadata to chunks:
```typescript
interface Chunk {
  text: string;
  metadata: {
    source: string;      // file path or URL
    title: string;       // document title
    section: string;     // heading hierarchy
    position: number;    // chunk index in document
    totalChunks: number;
  };
}
```

## Best Practices
- Include section headings in each chunk for context
- Overlap prevents information loss at boundaries
- Test different sizes — measure retrieval quality, not just embedding speed
- Preserve code blocks and tables as single chunks
- Re-chunk when content updates, do not append
