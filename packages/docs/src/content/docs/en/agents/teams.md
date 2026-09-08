---
title: Teams & delegation
description: Colleagues you talk to, specialists they spawn, and when a team proposal still appears.
---

**What this is for.** You talk to **colleagues** (primary and team agents). They have strict roles. They hand work to another colleague or spawn **specialists** from a shared pool — automatically, often in parallel. A team-proposal card appears only when a specialist is missing, you asked for a team, or the work is epic.

This is collaboration, not God Mode (several models racing the same task).

## When to use it

- You want to talk to the Personal Assistant or the System Engineer as people, not as a hidden dropdown.
- A job needs several specialists at once (`run_specialist` in one turn).
- Git worktrees so parallel editors do not clash (implicit sessions with two or more writer specialists, and epic team proposals).
- You still want a visible plan to **Approve** when a specialist does not exist yet.

## Typical workflow

1. Open a **colleague** from the sidebar (or pick one on a new conversation).
2. Ask them to do the work. They should `handoff_to_colleague` or `run_specialist` instead of doing another role's job.
3. Specialist runs show up as sub-conversations. Team memory works without a proposal card (implicit session).
4. Open **Team / Sub-conversations → Open Team Dashboard** when several specialists are in flight.
5. A **Team proposal** card still appears for `/team`, “use a team”, or epic work — **Approve** or **Skip**.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Colleague** | Primary or team agent you DM. Has a home thread and a voice (SOUL). |
| **Specialist** | Narrow worker. Shared pool — any colleague can spawn any enabled specialist. |
| **`run_specialist`** | Inline spawn; waits for a summary. Green (no click). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Opens the other colleague's home thread and starts them. Green. |
| **`assign_task`** | Asynchronous board card. Green when the target is enabled. |
| **`propose_team`** | Card for missing roles / epic / explicit ask. Still yellow. |
| **Home thread** | One continuous conversation per colleague. |
| **Implicit work session** | Created on the first specialist spawn so team memory works without a card. |

## Tiers

| Tier | You talk to them? | Typical job |
|------|-------------------|-------------|
| **Primary** | Yes | Setup teammates (Assistant, Engineer) |
| **Team** | Yes | Standing colleagues (reviewer, critic, …) |
| **Specialist** | No (child / task only) | Single-domain execution |

## Worktrees & verify

| Behaviour | When |
|-----------|------|
| **Git worktrees** | Two or more writer specialists in an implicit session, and team proposals for **complex** / **epic** goals — under `.eyas-worktrees/` |
| **Verify commands** | Optional `agent.verifyCommands` in YAML — see [Configuration](/docs/en/deploy/configuration/) |

## In conversations

See [Conversations](/docs/en/daily/conversations/):

- Sub-conversation tree
- Team Dashboard (findings, decisions, blockers)
- Team proposal **Approve / Skip / Create missing specialists** when a card is needed
- Handoff **Open** on the tool row when a colleague takes over

## Setup path

The setup wizard creates two primary colleagues. Optional **Team agents** adds more colleagues. Specialists come from templates or **Create Agent**. Change later under Agents.

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Runs & Mission Control](/docs/en/agents/runs/)
- [Agents overview](/docs/en/agents/overview/)
