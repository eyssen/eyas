---
title: Glossary
description: Product terms.
---

| Term | Definition |
|------|------------|
| Agent | Configured AI actor |
| Primary | Always-on setup teammates |
| Skill | Markdown procedure pack |
| Tool | Invokable capability |
| Coding surface | Model-agnostic file tools (`read_file`, `edit_file`, `grep`, …) owned by EYAS, not by a single vendor SDK |
| Worktree | Isolated git working tree for a parallel team agent (`.eyas-worktrees/`) |
| Verify commands | Configured lint/test programs run after an agent run before the LLM critic |
| Tool hook | PreToolUse / PostToolUse callback on every tool execution |
| Board | Work tracking surface |
| Conversation | Chat thread |
| Memory tier | Working→episodic→vault→archive |
| Memory block | Scoped shared note (company/agent/team/run) agents read/write via tools |
| Vault | Markdown long-term knowledge |
| Provider | LLM backend |
| MCP | Model Context Protocol |
| Connection | Named external system inventory entry (Odoo, GitHub, MCP, …) with health + vault secrets |
| Channel | External messaging connector |
| Grounding | Requiring search/retrieval evidence before claiming facts from indexed sources |
| Hybrid search | FTS + vector retrieval fused (RRF) |
| Search source | Named indexed tree (paths + optional label/version/edition/family) under Search Sources |
| Code source pin | Conversation or project selection of which search sources agents may query |
| needsPin | Tool response when several odoo-family versions are ready but none are pinned |
| Prompt Enhancer | Iterative coach for conversation draft prompts (model-family aware) |
| Prompt Coach | Iterative coach for durable project / agent system prompts |
| Forge | Approved soul/identity changes |
| Security gate | Pre-action policy |
| CASL | Authorization library |
| Orchestration | Solo/Auto/Deep sub-agent policy |
| Effort | Reasoning depth setting |
| SLA breach | Proactive signal for overdue or stale work |
| A2A | Agent-to-agent protocol (card + task execution) |
