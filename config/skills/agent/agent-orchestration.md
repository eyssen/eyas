---
name: agent-orchestration
description: Multi-agent orchestration patterns for complex task execution in EYAS
trigger_patterns:
  - "agent orchestration"
  - "multi agent"
  - "agent team"
  - "agent workflow"
  - "agent coordination"
capabilities:
  - team-orchestration
  - workflow-management
  - task-delegation
version: "1.0.0"
---
# Agent Orchestration

## Orchestration Models

### Sequential Pipeline
- Agents execute in order, each output feeds the next
- Agent A → Agent B → Agent C → Result
- Use for: data transformation pipelines, review chains
- Simple but slow (no parallelism)

### Parallel Fan-Out / Fan-In
- Coordinator sends tasks to multiple agents simultaneously
- Collects and merges results
- Use for: research (search multiple sources), brainstorming
- Fast but requires result merging logic

### Hierarchical (Manager-Worker)
- Manager agent plans and delegates subtasks
- Worker agents execute and report back
- Manager synthesizes results and decides next steps
- Use for: complex projects, multi-step planning

### Peer-to-Peer
- Agents collaborate as equals
- No central coordinator
- Consensus-based decision making
- Use for: debate, devil's advocate, diverse perspectives

## Team Composition
- **Product Owner:** defines requirements and acceptance criteria
- **Developer:** implements the solution
- **QA Engineer:** validates quality, writes tests
- **Devil's Advocate:** challenges assumptions, finds weaknesses
- **Researcher:** gathers external information and references

## Orchestration Protocol
1. **Planning:** coordinator breaks task into subtasks
2. **Assignment:** subtasks assigned to appropriate agents
3. **Execution:** agents work (sequentially or in parallel)
4. **Checkpoint:** coordinator reviews intermediate results
5. **Iteration:** adjust plan based on findings
6. **Synthesis:** merge all agent outputs into final result
7. **Approval:** user reviews and approves final output

## Context Sharing
- Shared context: all agents see the same project description
- Private context: agent-specific instructions and persona
- Conversation history: passed between agents for continuity
- Memory: agents can read/write shared memory

## Failure Handling
- Agent timeout: reassign task or use fallback agent
- Conflicting outputs: escalate to user for decision
- Quality check failure: retry with additional guidance
- Budget exceeded: stop and present partial results

## Best Practices
- Define clear success criteria before starting
- Keep agent teams small (3-5 agents)
- Use checkpoints to catch issues early
- Log all agent interactions for audit
- Allow user intervention at any checkpoint
