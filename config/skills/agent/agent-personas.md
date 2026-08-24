---
name: agent-personas
description: Designing effective AI agent personas with system prompts and behavior guidelines
trigger_patterns:
  - "agent persona"
  - "system prompt"
  - "agent personality"
  - "agent role"
  - "agent character"
capabilities:
  - persona-design
  - system-prompt-writing
  - behavior-specification
version: "1.0.0"
---
# Agent Personas

## Persona Design Framework

### Core Components
1. **Role:** what the agent IS (e.g., "senior software engineer")
2. **Goal:** what the agent tries to achieve
3. **Constraints:** what the agent must NOT do
4. **Communication style:** tone, formality, verbosity
5. **Knowledge domain:** areas of expertise
6. **Decision-making:** how to handle uncertainty

### System Prompt Structure
```
You are [ROLE] with expertise in [DOMAINS].

## Goal
[Primary objective in 1-2 sentences]

## Behavior
- [Rule 1]
- [Rule 2]
- [Rule 3]

## Communication Style
[Tone, format, language preferences]

## Constraints
- NEVER [hard constraint]
- ALWAYS [required behavior]

## Examples
[2-3 examples of expected behavior]
```

## Persona Types

### Task-Oriented
- Focused on completing specific tasks efficiently
- Minimal conversation, maximum action
- Example: code generator, data analyst, translator

### Advisory
- Provides guidance and recommendations
- Explains reasoning and trade-offs
- Example: architect, reviewer, mentor

### Creative
- Generates ideas and alternatives
- Explores possibilities broadly
- Example: brainstormer, writer, designer

### Critical
- Challenges assumptions and finds weaknesses
- Asks probing questions
- Example: devil's advocate, security auditor, QA

## Calibrating Behavior

### Verbosity Levels
- Minimal: answer only what is asked
- Standard: answer with brief context
- Detailed: full explanation with examples
- Specify in system prompt: "Be concise — answer in 1-3 sentences unless asked for detail"

### Confidence Handling
- Specify: "If uncertain, say so explicitly. Never guess."
- Or: "Provide your best estimate and note the confidence level."
- Or: "Ask for clarification rather than assuming."

### Tool Usage Style
- Proactive: agent uses tools automatically when helpful
- Conservative: agent asks permission before using tools
- Specify: "Always use the search tool before answering factual questions."

## Testing Personas
- Prepare 10-15 test scenarios covering typical and edge cases
- Check: does the agent stay in character?
- Check: does the agent follow constraints consistently?
- Check: is the communication style appropriate?
- Iterate: refine prompt based on failures

## Anti-Patterns
- Overly complex personas (> 2000 words of instructions)
- Contradictory rules in the same prompt
- Vague instructions ("be helpful" — how?)
- No examples of expected behavior
- Personality over function (role-playing > task completion)
