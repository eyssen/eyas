---
name: agent-governance
description: AI agent security governance — sandboxing, tool permissions, and audit trails
trigger_patterns:
  - "agent security"
  - "agent governance"
  - "tool permissions"
  - "agent sandbox"
  - "ai safety"
capabilities:
  - security
version: "1.0.0"
---
# AI Agent Governance

## Principle of Least Privilege
Every agent should have only the minimum permissions needed:
```typescript
interface AgentPermissions {
  tools: string[];          // allowed tool IDs
  maxBudgetUsd: number;     // spending limit per execution
  maxTokens: number;        // token consumption limit
  allowedModels: string[];  // which models can be used
  networkAccess: boolean;   // can make external requests
  fileAccess: 'none' | 'read' | 'readwrite';
}
```

## Sandboxing Rules
- Agents execute in isolated contexts — no shared mutable state
- File system access restricted to designated directories
- Network access whitelist — only allowed domains
- No direct database write access — go through validated API

## Tool Authorization
```typescript
// Every tool call must be checked
async function executeTool(agent: Agent, tool: string, params: unknown) {
  if (!agent.permissions.tools.includes(tool)) {
    throw new ForbiddenError(`Agent ${agent.id} not authorized for tool: ${tool}`);
  }
  await auditLog.record({ agentId: agent.id, tool, params, timestamp: Date.now() });
  return toolRegistry.execute(tool, params);
}
```

## Audit Trail
Log every agent action with:
- Agent ID and conversation context
- Tool invoked and parameters
- Result summary (not full output if large)
- Token consumption and cost
- Timestamp and duration

## Human-in-the-Loop Checkpoints
- Destructive operations (delete, deploy, send email) require approval
- Budget threshold exceeded — pause and request confirmation
- Unfamiliar tool patterns — flag for review
- Sensitive data access — log and notify

## Anti-Patterns
- Never give agents `manage: all` permissions
- Never allow agents to modify their own permissions
- Never let agents execute arbitrary code without sandboxing
- Never skip audit logging for "performance"

## Monitoring
- Track token spend per agent over time
- Alert on unusual tool usage patterns
- Review agent conversations periodically
- Measure task success rate — low success may indicate prompt injection
