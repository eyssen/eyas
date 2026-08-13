---
name: multi-agent-orchestration
description: Multi-agent orchestration patterns — routing, delegation, and coordination
trigger_patterns:
  - "multi agent"
  - "agent orchestration"
  - "agent routing"
  - "agent delegation"
  - "agent team"
capabilities:
  - ai
version: "1.0.0"
---
# Multi-Agent Orchestration

## Orchestration Patterns

### Router Pattern
A coordinator agent dispatches tasks to specialized agents:
```typescript
async function routeTask(task: Task): Promise<Result> {
  const agentType = await router.classify(task.description);
  const agent = agentRegistry.get(agentType);
  return agent.execute(task);
}
```

### Pipeline Pattern
Agents process sequentially, each adding to the result:
```
Researcher → Analyst → Writer → Reviewer → Final Output
```

### Parallel Fan-Out
Multiple agents work simultaneously on different aspects:
```typescript
const [research, analysis, risks] = await Promise.all([
  researchAgent.execute(task),
  analysisAgent.execute(task),
  riskAgent.execute(task),
]);
const synthesis = await synthesizerAgent.combine(research, analysis, risks);
```

### Debate Pattern
Agents argue opposing positions, a judge decides:
```typescript
const proposal = await proposerAgent.propose(task);
const critique = await criticAgent.critique(proposal);
const revision = await proposerAgent.revise(proposal, critique);
const decision = await judgeAgent.evaluate(proposal, critique, revision);
```

## Agent Communication
```typescript
interface AgentMessage {
  from: string;       // agent ID
  to: string;         // target agent or 'broadcast'
  type: 'task' | 'result' | 'feedback' | 'escalate';
  content: unknown;
  conversationId: string;
}
```

## State Management
- Share context through a common workspace (not direct memory sharing)
- Each agent has its own conversation history
- Orchestrator maintains overall task state and progress

## Checkpoints
- After each agent step, save state for recovery
- Allow human intervention at defined checkpoints
- Support resuming from last successful checkpoint

## Best Practices
- Define clear agent roles with non-overlapping responsibilities
- Set token and time budgets per agent
- Implement circuit breakers — escalate if agent loops or fails
- Log all inter-agent communication for debugging
- Test agents individually before testing orchestration
- Keep the number of agents small (3-5) to manage complexity
