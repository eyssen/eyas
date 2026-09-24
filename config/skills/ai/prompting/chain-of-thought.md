---
name: chain-of-thought
description: Chain-of-thought prompting for complex reasoning tasks
trigger_patterns:
  - "chain of thought"
  - "step by step"
  - "reasoning"
  - "think through"
  - "cot prompting"
capabilities:
  - ai
version: "1.0.0"
---
# Chain-of-Thought Prompting

## Basic Pattern
Add "Think step by step" or provide a reasoning example:
```
Q: A store has 4 boxes. Each box has 3 bags. Each bag has 5 apples. How many apples total?
A: Let me think step by step.
1. 4 boxes, each with 3 bags = 4 x 3 = 12 bags
2. 12 bags, each with 5 apples = 12 x 5 = 60 apples
Answer: 60 apples
```

## Structured CoT Template
```
Analyze the following problem. Before answering:
1. Identify the key information
2. List any assumptions
3. Work through the logic step by step
4. Verify your reasoning
5. Provide your final answer

Problem: [problem description]
```

## Self-Consistency (SC-CoT)
Generate multiple reasoning paths and pick the most common answer:
```typescript
const responses = await Promise.all(
  Array.from({ length: 5 }, () =>
    model.generate(prompt, { temperature: 0.7 })
  )
);
const answers = responses.map(extractFinalAnswer);
const consensus = mostFrequent(answers);
```

## When to Use CoT
- Math and logic problems
- Multi-step reasoning (legal analysis, debugging)
- Classification with justification
- Planning and decision-making
- Code review with explanations

## When NOT to Use
- Simple factual lookups
- Creative writing (adds unnecessary structure)
- When latency matters (CoT generates more tokens)
- Trivial classification tasks

## Extended Thinking
For complex tasks, use models with extended thinking capabilities:
```typescript
const response = await model.generate(prompt, {
  thinking: { type: 'enabled', budgetTokens: 10000 },
});
```
This allows the model to use internal reasoning before producing the final answer, improving accuracy on complex tasks significantly.

## Tips
- Show the reasoning format you expect in examples
- Ask the model to verify its own answer at the end
- For code: ask to trace execution step by step before writing
