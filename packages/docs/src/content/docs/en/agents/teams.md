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

1. Open a **colleague** from the sidebar (**Colleagues**), or pick one on a new conversation.
2. Ask them to do the work. They should `handoff_to_colleague` or `run_specialist` instead of doing another role's job.
3. Specialist runs show up as sub-conversations. Team memory works without a proposal card (implicit session).
4. Click **Open Team Dashboard** when several specialists are in flight.
5. A **Team proposal** card still appears for `/team`, “use a team”, or epic work — **Approve** or **Skip**.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Colleague** | Primary or team agent you DM. Has a home thread and a voice (SOUL). |
| **Specialist** | Narrow worker. Shared pool — any colleague can spawn any enabled specialist. |
| **`run_specialist`** | Inline spawn; waits for a summary. Green (no click). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Opens the other colleague's home thread and starts a run there at once, with the brief as its goal. Refused with a *busy* message while that thread is busy. Green. See [Conversations — Handoff](/docs/en/daily/conversations/#handoff). |
| **`assign_task`** | Asynchronous board card. Green when the target is enabled. |
| **`propose_team`** | Card for missing roles / epic / explicit ask. Yellow. |
| **Home thread** | One continuous conversation per colleague. |
| **Implicit work session** | Created on the first specialist spawn so team memory works without a card. |

## Tiers

| Tier | You talk to them? | Typical job |
|------|-------------------|-------------|
| **Primary** | Yes | Setup teammates (Assistant, Engineer) |
| **Team** | Yes | Standing colleagues (reviewer, critic, …) |
| **Specialist** | No (child / task only) | Single-domain execution |

## One way to run specialists, on every provider

Specialists always run through EYAS. When a colleague fans work out — in **Auto** and **Deep** orchestration alike — it starts specialists with `run_specialist`, whichever provider it runs on: Claude Code, Grok CLI, Kimi CLI or an API provider. Claude Code does not spawn hidden subagents of its own: its built-in Task/Agent tool is not offered.

Each specialist runs with its EYAS agent setup — persona prompt, EYAS memory, configured tools — and appears as a sub-conversation you can open, with its own supervised run and transcript. **Deep** mode on Claude Code can take longer, because each specialist is a full EYAS run of its own.

**Deep gives every model the same instruction:** split non-trivial work and run one specialist per independent slice, in parallel, each with a precise, self-contained brief; hand off with `handoff_to_colleague` when another colleague owns the job; propose a team only when a needed specialist does not exist yet; verify important results before concluding; and keep the final synthesis yourself.

**Security.** The security gate does not pre-approve Claude Code's subagent tool name. Claude Code is never offered that tool, and a call to it would be treated as unclassified and escalated for approval instead of allowed.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">Which model and effort a specialist or member uses</h2>

**Model.** An agent's model is a provider + model pair (see [Configure — Model & effort](/docs/en/agents/configure/#model--effort)). When it is empty, the agent runs on the conversation's own model:

- A **specialist** started with `run_specialist` / `delegate_to_agent`, a card handed out with `assign_task` and a sub-conversation made with `create_sub_conversation` run on the model **the delegating turn actually ran on**. That pair is stored on the new sub-conversation; it is not copied from the parent conversation's saved settings. On Claude Code, Grok and Kimi the delegating turn's model reaches the bridged EYAS tools too.
- A **team member** runs on its own model, else on the lead's current model (the model the parent conversation runs on right now; for an Auto-routing conversation, its Standard tier), else on the install default.
- With none of these, the install default is used (Standard tier → default provider → first active provider with an enabled model, CLI providers included), and it is fixed on that conversation the first time it runs.
- If the agent's own model cannot be used (its provider is switched off or the model is disabled), the run uses the conversation's stored model (the delegating turn's), else the default, and the reply records the note `agent-binding-unavailable`. EYAS never picks some other provider by name. With no model configured at all, the run fails with *No model is configured…* and is not retried.

There is no Anthropic-only team model router: a team member without a model does not run on the Anthropic API just because an Anthropic key is configured, and team configurations have no `modelRouting`.

**Effort.** A member or specialist with its own effort keeps it. One without inherits the level of the conversation that delegated the work, so a **Deep** conversation sends its specialists to *Max* — which costs more. Every level is then fitted to the model that answers, and each reply records what was asked for and what ran. See [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort).

## Memory and tools in team runs

- Specialists, delegated agents and team members get the same recalled-memory block as a chat turn, attached to their task or brief (see [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model)).
- Each team member's brief is also remembered, as text an agent wrote rather than yours.
- Durable-memory capture runs on each specialist, delegated agent and team member too, under the same `memory.capture.*` settings as a chat turn. The task or brief is read as an instruction an agent may have written: only facts it states about you, the project or the world are kept, never the task's own steps. Each runs in its own sub-conversation, so it has its own `maxPerConversation` ceiling, and each run whose instruction is at least `minUserChars` long can spend one extra background model call. See [Memory — Capture is on by default](/docs/en/knowledge/memory/#capture-is-on-by-default).
- Each member is offered its agent's **Tools** list plus the memory tools ([Configure — Tools](/docs/en/agents/configure/#tools--constraints)), on every provider.
- In a team run every member shows its live current tool, whatever its provider.

## Team proposal and re-planning

The team proposal is written by EYAS's background model in one isolated call without tools, on the planning tiers: **Quick**, then **Standard**, then the install default or another provider that can run isolated calls. Without an eligible background model — for example an install whose only model is a Grok CLI or Kimi CLI that EYAS has not yet verified as able to run isolated calls, or when the model budget is exhausted — the card proposes a single agent (the first enabled agent). Between phases, the re-planner works the same way: without an eligible background model the team keeps its current plan. See [Routing & budget — The background model](/docs/en/ai/routing-budget/#background-model).

## Worktrees & verify

| Behaviour | When |
|-----------|------|
| **Git worktrees** | Two or more writer specialists in an implicit session, and team proposals for **complex** / **epic** goals — under `.eyas-worktrees/` |
| **Verify commands** | Optional `agent.verifyCommands` in YAML — see [Configuration](/docs/en/deploy/configuration/) |

## In conversations

See [Conversations](/docs/en/daily/conversations/):

- Sub-conversation tree
- Team Dashboard (findings, decisions, blockers)
- Team proposal card: **Approve** / **Skip**, and **Create now** for missing specialists
- **Open &lt;name&gt;** on the tool row when a colleague takes over

## Setup path

The setup wizard creates two primary colleagues. The optional **Team Agents** step adds more colleagues and specialists. Specialists also come from templates or **Create Agent**. Change them later under **Agents**.

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Runs & Mission Control](/docs/en/agents/runs/)
- [Agents overview](/docs/en/agents/overview/)
