---
title: Glossary
description: Product terms.
---

| Term | Definition |
|------|------------|
| Agent | Configured AI actor |
| Primary | Always-on setup teammates |
| Skill | Markdown procedure pack |
| Skill proposal | A matched skill the conversation turn waits on — **Use it**, **Not this time**, or owner/admin **Turn it off** |
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
| Capture run | One post-turn durable-memory extraction; every outcome writes a `memory_capture_runs` row (skip, write, unparsable, error). Off switch: `memory.capture.enabled` |
| Design canvas | Multi-artboard `.dc.html` + `canvas.json` design, Claude Design file format with EYAS's own runtime |
| Provider | LLM backend |
| MCP | Model Context Protocol |
| Connection | Named external system inventory entry (Odoo, GitHub, MCP, …) with health + vault secrets |
| Channel | External messaging connector (Telegram, Slack, email, …) — not a Connection, not a Hand |
| Hand | Paired local client that offers OS/CLI/desktop tools to this EYAS ([Hands](/docs/en/admin/hands/)) |
| Studio | Local production engines (HTML or footage → file). Not Media. ([Studio](/docs/en/studio/)) |
| Video Use | Studio engine that cuts raw footage from an EDL ([Video Use](/docs/en/studio/videouse/)) |
| Browser Use | Optional CLI sidecar that drives a real logged-in Chrome via CDP ([Browser Use](/docs/en/automation/browser-use/)) |
| Remote node | Another machine this instance can reach (SSH and friends) so agents can run work off this box ([Nodes](/docs/en/admin/nodes/)) |
| Extension pack | Third-party skill pack installed from the catalogue, MIT-compatible license check ([Extensions](/docs/en/admin/extensions/)) |
| Recordly | AGPL desktop screen recorder; third-party companion via Extensions, not bundled, not a Studio engine ([Recordly](/docs/en/admin/extensions/#recordly)) |
| Grounding | Requiring search/retrieval evidence before claiming facts from indexed sources |
| Hybrid search | FTS + vector retrieval fused (RRF) |
| Search source | Named indexed tree (paths + optional label/version/edition/family) under Search Sources |
| Code source pin | Conversation or project selection of which search sources agents may query |
| Working directories | Ordered absolute folders where a conversation may read/write; first is the primary cwd. Project default, inherited by conversations |
| needsPin | Tool response when several odoo-family versions are ready but none are pinned |
| Prompt Enhancer | Iterative coach for conversation draft prompts (model-family aware) |
| Prompt Coach | Iterative coach for durable project / agent system prompts |
| Forge | Approved soul/identity changes |
| God Mode | Conversation orchestration that races the same task across a Settings roster of models; a chair breaks even counts |
| Security gate | Pre-action policy |
| CASL | Authorization library |
| Orchestration | Solo/Auto/Deep sub-agent policy (plus God Mode) |
| Effort | Reasoning depth setting |
| SLA breach | Proactive signal for overdue or stale work |
| A2A | Agent-to-agent protocol (card + task execution) |
