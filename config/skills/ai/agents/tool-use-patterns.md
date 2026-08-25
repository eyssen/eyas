---
name: tool-use-patterns
description: AI agent tool use — definition, execution, and result handling patterns
trigger_patterns:
  - "tool use"
  - "function calling"
  - "ai tools"
  - "tool definition"
  - "agent tools"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Vercel AI SDK
    url: https://github.com/vercel/ai
    license: MIT
---
# Tool Use Patterns

## Tool Definition (AI SDK)
```typescript
import { tool } from 'ai';
import { z } from 'zod';

const searchTool = tool({
  description: 'Search the knowledge base for relevant information',
  parameters: z.object({
    query: z.string().describe('The search query'),
    limit: z.number().min(1).max(20).default(5).describe('Number of results'),
    filter: z.enum(['all', 'docs', 'code']).optional(),
  }),
  execute: async ({ query, limit, filter }) => {
    const results = await knowledgeBase.search(query, { limit, filter });
    return results.map(r => ({ title: r.title, snippet: r.snippet, score: r.score }));
  },
});
```

## Tool Categories
- **Retrieval** — search, fetch data, read files
- **Action** — create, update, delete (require confirmation)
- **Computation** — calculate, transform, format
- **Communication** — send email, post message

## Execution Loop
```typescript
import { generateText } from 'ai';

const { text, toolCalls, toolResults } = await generateText({
  model,
  messages,
  tools: { search: searchTool, calculate: calcTool },
  maxSteps: 5,  // allow up to 5 tool calls in sequence
});
```

## Error Handling in Tools
```typescript
execute: async (params) => {
  try {
    const result = await performAction(params);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
    // Return error to model — let it decide next step
  }
}
```

## Best Practices
- Write clear `description` — the model uses it to decide when to call the tool
- Describe each parameter — `z.string().describe('...')`
- Return structured results, not raw data dumps
- Limit result size — summarize or paginate large results
- Log every tool call for audit and debugging
- Validate tool parameters even though Zod handles basics
- Implement timeouts on tool execution
- Never expose destructive tools without confirmation step
