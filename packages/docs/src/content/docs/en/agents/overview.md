---
title: Agents overview
description: See every agent, filter by tier, and open one to configure it.
---

**What this is for.** The Agents list is the roster: who exists, whether they are on, which tier they sit in, and how much budget they have used. You create, enable, and open agents here. Detail work (model, tools, voice, workspace, channels) lives on the agent page.

## When to use it

- You want to see which agents are enabled, proposed, or over budget.
- You need a new teammate — **Create Agent** — or to open an existing one.
- You want only **Primary**, **Team**, or **Specialist** rows.
- You are about to bind tools, voice, or a channel and need the right agent first.

## Typical workflow

1. Open **Agents** in the sidebar (**AI** section) — route `/agents`.
2. Filter **All / Enabled / Primary / Team / Specialist** if the list is long.
3. Click a row (or **Create Agent**). You land on the detail tabs: **Configuration**, **Memories**, **Voice**, **Workspace**, **Channels**.
4. Save. The list should show the new/updated name, tool count, and budget.

## Features

Subtitle in the app: *Manage AI agents, capabilities, and tool assignments.*

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
