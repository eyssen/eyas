---
title: Agents overview
description: List, filters, badges, tiers, and types — every list-screen control.
---

**Route:** `/agents`.  
Subtitle: *Manage AI agents, capabilities, and tool assignments.*

## List header

| Control | Meaning |
|---------|---------|
| **enabled** label | Count/context of enabled agents |
| **Create Agent** | Open create flow / form |
| Filters **All / Enabled / Primary / Team / Specialist** | Restrict the list by status or tier |

## List row data

| Element | Meaning |
|---------|---------|
| Name + avatar | Agent identity |
| **N tools** | Bound tool count |
| **N constraints** | Constraint count |
| **used / budget tokens** | Monthly token usage vs budget |
| Empty / loading / error | Load states |

## Badges

| Badge | Meaning |
|-------|---------|
| **Built-in** | Shipped / seed agent |
| **Custom** | User-created |
| **Proposed** | Proposed (e.g. forge / team proposal) |
| **Pending Approval** | Awaiting approval |
| **Active** | Enabled and usable |
| **Disabled** | Turned off (not deleted) |

## Tiers

| Tier | Meaning |
|------|---------|
| **Primary** | Always-on teammates from setup |
| **Team** | Core team members for delegation |
| **Specialist** | Narrow specialists |

## Agent types

| Type | Typical role |
|------|----------------|
| **Assistant** | General personal assistant |
| **Engineer** | System / platform engineer |
| **Developer** | Implementation |
| **Reviewer** | Code/review |
| **Critic** | Adversarial critique |
| **Researcher** | Research |
| **Planner** | Planning |
| **Coordinator** | Multi-agent coordination |
| **Observer** | Read-mostly observation |

## Opening an agent

Click a row → detail page with tabs:

| Tab | Docs |
|-----|------|
| **Configuration** | [Create & configure](/docs/en/agents/configure/) |
| **Memories** | Memory entries for this agent |
| **Voice** | [Voice profiles](/docs/en/agents/voice/) |
| **Workspace** | [Identity & workspace](/docs/en/agents/identity-workspace/) |
| **Channels** | Bind messaging instances |

## Related

- [Create & configure](/docs/en/agents/configure/)
- [Teams & delegation](/docs/en/agents/teams/)
- [Runs & Mission Control](/docs/en/agents/runs/)
