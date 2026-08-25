---
name: agent-memory
description: Agent memory systems — working, episodic, semantic, and long-term memory
trigger_patterns:
  - "agent memory"
  - "long term memory"
  - "working memory"
  - "memory management"
  - "context window"
capabilities:
  - ai
version: "1.0.0"
---
# Agent Memory Systems

## Memory Tiers
```
┌─────────────────────────────────────────┐
│  Working Memory (context window)         │  ← current conversation
├─────────────────────────────────────────┤
│  Short-Term / Episodic                   │  ← recent interactions
├─────────────────────────────────────────┤
│  Long-Term / Semantic                    │  ← learned facts & patterns
├─────────────────────────────────────────┤
│  Archive                                 │  ← compressed old memories
└─────────────────────────────────────────┘
```

## Working Memory (Context Window)
The current conversation context. Limited by model token window.
```typescript
interface WorkingMemory {
  systemPrompt: string;
  recentMessages: Message[];     // last N turns
  activeContext: string[];       // retrieved relevant memories
  toolResults: ToolResult[];     // pending tool outputs
}
```

## Episodic Memory
Specific past interactions, stored with timestamps:
```typescript
interface Episode {
  id: string;
  timestamp: Date;
  summary: string;           // compressed representation
  keyEntities: string[];     // people, topics, decisions
  outcome: 'success' | 'failure' | 'partial';
  embedding: number[];       // for similarity search
}
```

## Semantic Memory
Learned facts and relationships:
```typescript
interface SemanticMemory {
  fact: string;              // "User prefers TypeScript over JavaScript"
  confidence: number;        // 0-1, increases with repetition
  source: string;            // conversation ID where learned
  lastAccessed: Date;
}
```

## Memory Management
```typescript
// Context window management
function buildContext(memories: Memory[], maxTokens: number): Memory[] {
  // Priority: system prompt > recent messages > relevant memories > older context
  const sorted = memories.sort((a, b) => b.relevance + b.recency - a.relevance - a.recency);
  let tokens = 0;
  return sorted.filter(m => {
    tokens += m.tokenCount;
    return tokens <= maxTokens;
  });
}
```

## Memory Lifecycle
1. **Capture** — extract important information from conversation
2. **Store** — save with embedding and metadata
3. **Consolidate** — merge similar memories, increase confidence
4. **Retrieve** — find relevant memories for current context
5. **Decay** — reduce relevance of unused memories over time
6. **Archive** — compress and move old memories to cold storage

## Best Practices
- Summarize conversations before storing (save tokens)
- Use vector search for memory retrieval (semantic matching)
- Implement forgetting — not everything is worth remembering
- Tag memories with entities for structured retrieval
- Separate user preferences from task context
- Test memory retrieval quality — wrong memories degrade performance
