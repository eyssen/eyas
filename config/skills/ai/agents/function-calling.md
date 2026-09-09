---
name: function-calling
description: AI function calling patterns with Anthropic Claude and structured outputs
trigger_patterns:
  - "function calling"
  - "claude tools"
  - "structured output"
  - "tool_use"
  - "anthropic tools"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Anthropic SDK
    url: https://github.com/anthropics/anthropic-sdk-typescript
    license: MIT
---
# Function Calling

## Anthropic Claude Tool Definition
```typescript
import Anthropic from '@anthropic-ai/sdk';

const tools: Anthropic.Tool[] = [{
  name: 'get_weather',
  description: 'Get current weather for a location. Use when user asks about weather.',
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name or coordinates' },
      units: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' },
    },
    required: ['location'],
  },
}];

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  tools,
  messages: [{ role: 'user', content: 'What is the weather in Budapest?' }],
});
```

## Handling Tool Use Response
```typescript
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await executeTool(block.name, block.input);
    // Send result back to model
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }],
    });
  }
}
```

## Structured Output via Tool
Force specific output format by defining a single tool:
```typescript
const extractTool: Anthropic.Tool = {
  name: 'extract_info',
  description: 'Extract structured information from the text',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
    },
    required: ['name', 'email', 'sentiment'],
  },
};
// With tool_choice: { type: 'tool', name: 'extract_info' }
```

## AI SDK Abstraction
```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const { text, toolCalls } = await generateText({
  model: anthropic('claude-sonnet-4-20250514'),
  tools: { weather: weatherTool, search: searchTool },
  maxSteps: 5,
  messages,
});
```

## Best Practices
- Write precise tool descriptions — model decides based on these
- Keep parameter schemas minimal — only what is needed
- Return concise tool results — large results waste context
- Handle tool errors gracefully — return error message, let model retry
- Use `tool_choice: 'auto'` for flexibility, `tool_choice: { type: 'tool', name }` to force
- Always validate tool inputs before execution
