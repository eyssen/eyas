---
name: system-prompts
description: System prompt design for AI assistants — persona, rules, and guardrails
trigger_patterns:
  - "system prompt"
  - "persona"
  - "assistant instructions"
  - "ai behavior"
  - "guardrails"
capabilities:
  - ai
version: "1.0.0"
---
# System Prompt Design

## Structure Template
```
You are [ROLE] for [CONTEXT].

## Core Behavior
- [Key behavior 1]
- [Key behavior 2]

## Rules
- [Hard constraint 1]
- [Hard constraint 2]

## Output Format
[Specify exact format expectations]

## What You Must NOT Do
- [Explicit prohibition 1]
- [Explicit prohibition 2]
```

## Effective Persona Design
```
You are a senior TypeScript developer working on a Bun-based backend.
You write clean, type-safe code with comprehensive error handling.
You prefer explicit types over inference for public APIs.
When unsure, you ask clarifying questions rather than guessing.
```

## Guardrails
- State boundaries explicitly: "Do not discuss topics outside of X"
- Define fallback behavior: "If you cannot answer, say 'I need more context'"
- Set tone: "Professional but approachable. No emojis."
- Limit scope: "Only use information from the provided context"

## Multi-Layer Prompt Architecture
```typescript
const systemPrompt = [
  basePersona,          // who the assistant is
  domainKnowledge,      // relevant context and rules
  toolInstructions,     // how to use available tools
  outputConstraints,    // format and style rules
  safetyGuardrails,     // what not to do
].join('\n\n');
```

## Versioning and Testing
- Treat system prompts as code — version control them
- Test with adversarial inputs (prompt injection attempts)
- A/B test prompt variations with real user queries
- Measure: task completion rate, user satisfaction, safety violations

## Common Mistakes
- Too long (dilutes important instructions)
- Contradictory rules
- Vague instructions ("be helpful" — how?)
- No output format specification
- Missing edge case handling
- No explicit prohibitions (model fills the gaps unpredictably)

## Maintenance
- Review prompts when model version changes
- Log prompt version with every conversation for debugging
- Iterate based on failure cases, not theoretical concerns
