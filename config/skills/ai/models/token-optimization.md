---
name: token-optimization
description: Token usage optimization — prompt compression, caching, and context management
trigger_patterns:
  - "token optimization"
  - "token usage"
  - "context window"
  - "prompt compression"
  - "reduce tokens"
capabilities:
  - ai
version: "1.0.0"
---
# Token Optimization

## Prompt Compression Techniques

### Remove Redundancy
```
// Before (verbose)
"Please analyze the following text carefully and provide a detailed summary
of the main points. Make sure to include all important information."

// After (concise)
"Summarize the main points:"
```

### Structured Over Prose
```
// Before: "The user's name is Alice, she is 30 years old, works as an engineer"
// After:
Name: Alice
Age: 30
Role: Engineer
```

## Context Window Management
```typescript
interface ContextBudget {
  systemPrompt: number;    // fixed ~500 tokens
  recentMessages: number;  // last 3-5 turns ~2000 tokens
  retrievedContext: number; // RAG results ~3000 tokens
  toolResults: number;     // recent tool outputs ~1000 tokens
  responseBuffer: number;  // reserved for output ~2000 tokens
}

function fitToWindow(items: ContextItem[], maxTokens: number): ContextItem[] {
  let used = 0;
  return items
    .sort((a, b) => b.priority - a.priority)
    .filter(item => {
      if (used + item.tokens > maxTokens) return false;
      used += item.tokens;
      return true;
    });
}
```

## Conversation Summarization
```typescript
// When conversation exceeds threshold, summarize older messages
async function summarizeOlderMessages(messages: Message[], keepRecent: number): Promise<Message[]> {
  const recent = messages.slice(-keepRecent);
  const older = messages.slice(0, -keepRecent);

  if (older.length === 0) return recent;

  const summary = await llm.generate(
    `Summarize this conversation in 3-5 bullet points:\n${formatMessages(older)}`
  );

  return [
    { role: 'system', content: `Previous conversation summary:\n${summary}` },
    ...recent,
  ];
}
```

## Caching Strategies
- **Prompt caching** — Anthropic supports automatic prefix caching
- **Response caching** — cache identical queries (hash prompt → response)
- **Embedding caching** — reuse embeddings, recompute only on change

## Token Counting
```typescript
// Approximate: 1 token ~= 4 characters (English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// For accurate counting, use tiktoken or model-specific tokenizer
```

## Best Practices
- Set explicit `max_tokens` on every request
- Monitor token usage per feature — identify expensive paths
- Compress tool results before returning to model
- Use system prompt caching for stable prefixes
- Truncate large inputs rather than sending everything
- Use smaller models for token-heavy tasks (classification, extraction)
