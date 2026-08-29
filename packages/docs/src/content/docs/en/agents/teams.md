---
title: Teams & delegation
description: Plan multi-agent work — phases, handoffs, and the proposal you approve in chat.
---

**What this is for.** Teams are how a primary agent delegates. You configure phases here; in a conversation the agent may propose a plan you **Approve** or **Skip**. Sub-conversations and the Team Dashboard then show who is doing what. This is collaboration, not God Mode (several models racing the same task).

## When to use it

- A job needs specialists in parallel or in sequence, not one agent looping alone.
- You want git worktrees so parallel editors do not clash on the same files.
- Missing specialist templates should be created from the proposal card (**Create now**).
- You want a shared team memory of findings, decisions, and blockers.

## Typical workflow

1. Open **Agents** and confirm the primary plus specialists exist (setup wizard **Team agents**, or create them here).
2. Start a conversation, set **Orchestration** to **Auto** or **Deep**, and send a complex goal.
3. When a **Team proposal** card appears, review phases (parallel / sequential), then **Approve** (or **Create now** for missing specialists).
4. Open **Team / Sub-conversations → Open Team Dashboard**. You should see member chats, phase, and team memory entries.

## Features

Agents collaborate through **delegation**, **team sessions** in conversations, and optional **team configuration** UI.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Primary** | Orchestrates day-to-day work; can delegate |
| **Team / specialist** | Receives delegated tasks in their domain |
| **Handoff** | Passing work (often with artifacts) to another agent |
| **Team session** | Multi-agent run visible as sub-conversations |
| **Team proposal** | Plan the user must approve before fan-out |

## Team Builder (agent UI)

| Control | Meaning |
|---------|---------|
| **Team Builder** | Configure multi-phase team plans |
| **N phases** | Number of orchestration phases |
| **Est. ~N tokens** | Rough token estimate for the plan |

Phase modes (also on team proposals in chat):

| Mode | Meaning |
|------|---------|
| **parallel** | Agents in the phase run concurrently |
| **sequential** | Ordered steps |

### Worktrees & verify

| Behaviour | When |
|-----------|------|
| **Git worktrees** | Team proposals for **complex** and **epic** goals isolate agents under `.eyas-worktrees/` (avoids file conflicts on parallel edits) |
| **Verify commands** | Optional `agent.verifyCommands` in YAML runs lint/test after a run before the completeness critic — see [Configuration](/docs/en/deploy/configuration/) |

## In conversations

See [Conversations — Team features](/docs/en/daily/conversations/):

- Sub-conversation tree  
- Team Dashboard (findings, decisions, blockers)  
- Team proposal **Approve / Skip / Create missing specialists**  

## Setup path

Optional **Team agents** step in the [setup wizard](/docs/en/setup-wizard/) selects specialist templates. Change later under Agents / Settings.

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Runs & Mission Control](/docs/en/agents/runs/)
- [Agents overview](/docs/en/agents/overview/)
