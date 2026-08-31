---
name: agent-debugging
description: Debugging and troubleshooting AI agent behavior, prompts, and tool usage
trigger_patterns:
  - "agent debug"
  - "agent not working"
  - "agent error"
  - "agent troubleshoot"
  - "why did the agent"
capabilities:
  - agent-debugging
  - prompt-analysis
  - behavior-diagnosis
version: "1.0.0"
---
# Agent Debugging

## Common Issues

### Agent Not Following Instructions
- Check system prompt: is the instruction clear and unambiguous?
- Check prompt order: later instructions can override earlier ones
- Reduce prompt complexity: too many rules confuse the model
- Add examples: show the expected behavior with concrete cases
- Check temperature: lower temperature = more deterministic

### Agent Stuck in a Loop
- Check tool usage: is the agent calling the same tool repeatedly?
- Set max iterations/turns limit
- Check stop conditions: are they clearly defined?
- Look for circular dependencies in tool outputs
- Add explicit "if X then stop" instructions

### Agent Producing Wrong Output
- Review the full conversation history (system + user + assistant turns)
- Check if context is too long (information gets lost in long contexts)
- Verify tool responses: is the tool returning what the agent expects?
- Check for hallucination: agent may invent data not in the context
- Compare with a simpler prompt to isolate the issue

### Tool Call Failures
- Verify tool schema matches the implementation
- Check required parameters: are they all provided?
- Validate parameter types: string vs. number confusion
- Check authentication: API keys, tokens, permissions
- Review error messages in tool responses

## Debugging Techniques

### Conversation Replay
1. Export the full conversation (system prompt + all turns)
2. Replay step by step, checking each agent response
3. Identify the first point where behavior diverges from expected

### Prompt Ablation
1. Start with a minimal prompt that works
2. Add instructions one at a time
3. Find which instruction causes the problem
4. Rewrite the problematic instruction

### Tool Response Mocking
- Replace real tool responses with known-good data
- Isolate whether the problem is in tool output or agent reasoning
- Gradually replace mocked responses with real ones

## Logging Checklist
- System prompt (full text)
- Each user/assistant turn (full text)
- Tool calls: name, parameters, response
- Token usage per turn
- Model used and parameters (temperature, max_tokens)
- Timing: how long each turn took

## Metrics to Monitor
- Task completion rate
- Average turns per task
- Tool call success rate
- Token usage per task
- User intervention rate (agent asked for help)
- Error rate by error type

## Prevention
- Write clear, testable system prompts
- Include few-shot examples for complex behaviors
- Set appropriate limits (max turns, max tokens, timeout)
- Implement guardrails (content filtering, output validation)
- Regular prompt review and optimization
