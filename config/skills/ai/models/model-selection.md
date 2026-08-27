---
name: model-selection
description: AI model selection criteria — cost, quality, latency, and use case matching
trigger_patterns:
  - "model selection"
  - "which model"
  - "model comparison"
  - "gpt vs claude"
  - "model tier"
capabilities:
  - ai
version: "1.0.0"
---
# Model Selection Guide

## Selection Criteria
| Factor | Description |
|--------|-------------|
| **Quality** | Reasoning depth, accuracy, instruction following |
| **Speed** | Time to first token, tokens per second |
| **Cost** | Input/output price per million tokens |
| **Context** | Maximum context window size |
| **Features** | Tool use, vision, structured output, streaming |

## Tier-Based Routing
```typescript
type RoutingTier = 'quick' | 'balanced' | 'complex';

function selectModel(tier: RoutingTier): string {
  switch (tier) {
    case 'quick':    return 'claude-3-5-haiku';   // fast, cheap — classification, extraction
    case 'balanced': return 'claude-sonnet-4-20250514'; // good balance — most tasks
    case 'complex':  return 'claude-opus-4-20250514';   // best quality — complex reasoning, code
  }
}
```

## Use Case Mapping
| Use Case | Recommended Tier | Reason |
|----------|-----------------|--------|
| Chat / Q&A | balanced | Good enough quality, reasonable cost |
| Code generation | complex | Accuracy matters, fewer iterations |
| Classification | quick | Simple task, high volume |
| Summarization | balanced | Quality matters but not complex |
| Data extraction | quick | Structured, repetitive |
| Creative writing | complex | Nuance and quality important |
| Agent reasoning | complex | Multi-step logic needs best model |

## Cost Optimization
- Route simple tasks to cheaper models automatically
- Cache common queries — avoid redundant API calls
- Use shorter prompts — token count = cost
- Batch similar requests where possible
- Monitor spend per feature/user/agent

## Fallback Strategy
```typescript
const modelChain = ['claude-sonnet-4-20250514', 'gpt-4o', 'claude-3-5-haiku'];

async function generateWithFallback(prompt: string): Promise<string> {
  for (const model of modelChain) {
    try {
      return await generate(model, prompt);
    } catch (err) {
      logger.warn({ model, err: err.message }, 'Model failed, trying next');
    }
  }
  throw new Error('All models failed');
}
```

## Best Practices
- Start with the cheapest model that meets quality requirements
- A/B test model changes with eval suite before switching
- Log model, tokens, latency per request for analysis
- Review monthly: new models may offer better cost/quality ratio
- Use local models (Ollama) for development and testing
