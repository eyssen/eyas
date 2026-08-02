---
title: Tools
description: Built-in and extension tools agents can call.
---

**Route:** `/tools`.

Tools are **invokable capabilities** (filesystem, shell, browser, HTTP, MCP-backed tools, …). Assignment to an agent is on the agent **Configuration** tab (`Tools` comma-separated list) and via permissions / security gate.

| Concept | Meaning |
|---------|---------|
| Tool name | Stable id used in agent config and logs |
| Description | What the tool does (shown in catalogue) |
| Permissions | CASL / gate may block a call at runtime |
| Sandbox | Some tools run in restricted environments |

Configure MCP-backed tools under [MCP servers](/docs/en/ai/mcp/).

## Related

- [Agents — configure tools](/docs/en/agents/configure/)
- [Security gate](/docs/en/admin/security-privacy/)
