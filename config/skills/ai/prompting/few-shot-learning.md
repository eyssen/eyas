---
name: few-shot-learning
description: Few-shot prompting with examples for consistent AI outputs
trigger_patterns:
  - "few shot"
  - "examples in prompt"
  - "one shot"
  - "zero shot"
  - "in-context learning"
capabilities:
  - ai
version: "1.0.0"
---
# Few-Shot Learning

## Pattern
Provide input-output examples before the actual task:
```
Classify the sentiment of these product reviews.

Review: "Amazing battery life, very satisfied!"
Sentiment: positive

Review: "Arrived broken, terrible packaging."
Sentiment: negative

Review: "It works fine, nothing special."
Sentiment: neutral

Review: "The screen is gorgeous but the camera disappoints."
Sentiment:
```

## Shot Types
- **Zero-shot** — no examples, just instruction (works for simple tasks)
- **One-shot** — single example (establishes format)
- **Few-shot** — 3-5 examples (best balance of quality and token cost)
- **Many-shot** — 10+ examples (diminishing returns, use fine-tuning instead)

## Example Selection Guidelines
- Cover diverse cases — positive, negative, edge cases
- Match the difficulty of real inputs
- Use realistic data, not trivial examples
- Order matters: place harder examples last
- Include the exact output format you want

## Structured Few-Shot Template
```
You are a data extractor. Extract structured information from text.

Input: "Meeting with Alice on Jan 15 at 2pm in Room 301"
Output: {"attendee": "Alice", "date": "2025-01-15", "time": "14:00", "location": "Room 301"}

Input: "Call Bob tomorrow morning"
Output: {"attendee": "Bob", "date": "relative:tomorrow", "time": "morning", "location": null}

Input: "[actual user input]"
Output:
```

## Dynamic Few-Shot
Retrieve relevant examples at runtime based on input similarity:
```typescript
async function buildPrompt(input: string) {
  const examples = await vectorStore.search(input, { limit: 3 });
  const exampleBlock = examples
    .map(e => `Input: ${e.input}\nOutput: ${e.output}`)
    .join('\n\n');
  return `${systemPrompt}\n\n${exampleBlock}\n\nInput: ${input}\nOutput:`;
}
```

## Tips
- Consistent formatting across all examples
- If output quality varies, add more examples for the weak cases
- Test removing examples to find the minimum effective set
