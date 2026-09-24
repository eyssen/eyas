---
title: Autonomy
description: Set how much agents may do without asking — approval queue and three levels.
---

**What this is for.** Autonomy is the safety dial. Per class of action you choose **Notice** (ask first), **Approve** (propose + one-click), or **Auto** (do it and report). Outbound and irreversible actions stay locked at Notice. The same page is the **Pending approvals** queue that parks a run until you decide.

## When to use it

- A conversation is **Waiting approval** and you need to **Approve** or **Reject** without guessing what is parked.
- You want reversible work (file edits, research) to run at **Auto**, but never raise a locked outbound class.
- A resume failed after you already approved — the stuck row still needs you.
- You want to turn the background self-improvement loops on or off (proactive heartbeat, nightly reflection, Forge proposals, self-learning, skill adoption).

## Typical workflow

1. Open **Autonomy** in the sidebar (**Monitoring** section) — route `/autonomy`. The self-improvement loops are on **Settings → System**, card **Autonomy & self-improvement**.
2. Read **Pending approvals**. For each row, **Approve** or **Reject**. Follow **Run waiting on this** into the conversation if you need context.
3. Under **Reversible**, set a category to **Notice / Approve / Auto** (locked categories cannot go above Notice).
4. The parked run resumes (or stays stopped on reject). Home **Attention** and the conversation **Waiting approval** badge clear.

## Features

Autonomy controls **unattended** behaviour: how much an agent may do per class of action, and what requires **human approval**.

## Principles

1. The background self-improvement loops are **off by default**; turning them on is your choice.
2. Approvals surface under Home **Attention** and as the conversation **Waiting approval** badge.
3. Whether an agent may edit its own IDENTITY directly is a YAML setting, `autonomy.identitySelfUpdate` (default on). When it is off, identity changes go through Forge proposals.

## Approval queue and levels

**Route:** `/autonomy`. The subtitle explains that irreversible / outbound actions are locked at **Notice** and cannot be raised — a safety floor.

### Pending approvals

| Control | Meaning |
|---------|---------|
| **Pending approvals** | Queue of parked requests |
| *Nothing waiting for approval.* | Empty queue |
| Category · tool | What is being asked |
| Reason | Why the gate fired |
| **Run waiting on this** | Link to the parked run / conversation |
| **Approve / Reject** | Decide — approve tries to resume the run |
| *Could not resume: …* | The approval is decided, but the run did not restart (stuck resume) |

**What lands in the queue.** A yellow or red tool call waits here when the security gate asks for a human, on every provider — including calls a CLI (Claude Code, Grok, Kimi) wants to make with its own tools, and EYAS tools Grok or Kimi call through the tool bridge. In a supervised autonomous run, such an approval pauses the run (**Waiting approval**); once approved, the run resumes and exactly the approved call is allowed once.

**The same verdicts on every provider.** EYAS tools that Grok and Kimi reach through the tool bridge are decided exactly as on the API providers and Claude Code. In a chat you are attending, or a channel conversation, a call the gate allows runs: the levels on this page do not apply to attended chats, and a tool marked as needing approval no longer waits here just because the model is Grok or Kimi. In background runs (scheduled, team, pipeline, or any run not labelled as attended) the levels apply: a call in a category at **Notice** or **Approve** waits here, and a call the gate escalates always waits for a person, even when its category is at **Auto** — before, such a call ran unasked on Grok and Kimi. A tool outside the agent's **Tools** list is refused before the gate is asked, so it never lands here. When the gate's AI check cannot run — no eligible background model, a stopped budget, or every attempt failing — the call is escalated here instead of being blocked (see [Security & privacy — Security judge](/docs/en/admin/security-privacy/#security-judge)).

**A shell command that asks to leave the sandbox.** With `security.cliSandbox: auto`, Claude Code may ask to run one command outside the kernel file sandbox (for example one that needs `~/.npm`). Such a command always lands here and waits for a person — never the AI judge, never the autonomy ladder, whatever the category's level. Its reason reads *A shell command asked to run outside the kernel file sandbox. Only a person can allow this; approving lets exactly this command run once without the sandbox.* Autonomous runs park on it. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox).

**Deciding from the conversation.** A call that waits for approval is shown as *Needs approval*, never as succeeded, and an approval card appears in the conversation with **Approve**, **Reject** and **Open approvals**. The card uses the same permission as this queue (approve on Autonomy); a user without it is told that an owner or an admin can decide it here. See [Conversations — Approvals in the chat](/docs/en/daily/conversations/#approvals-in-the-chat).

### Levels (per category)

| Level | Label | Hint |
|-------|-------|------|
| 1 | **Notice** | Ask first |
| 2 | **Approve** | Propose + one-click approval |
| 3 | **Auto** | Autonomous + report after |

Categories split into **Reversible** (you may raise the level) and **Outbound / irreversible (locked)** (cannot go above Notice — a safety floor).

## Settings (Autonomy & self-improvement card)

**Settings → System** has the card **Autonomy & self-improvement**. Each loop that is on makes paid model calls on a schedule (or when triggered), and all are off by default:

| Toggle | Meaning |
|--------|---------|
| **Proactive heartbeat** | Composes proactive briefings when things need your attention |
| **Nightly reflection** | A nightly self-reflection pass that spots improvements in how the assistant works |
| **Forge proposals** | Proposes tool/skill improvements learned from friction — still needs your approval |
| **Self-learning** | Proposes prompt/routing tweaks learned from usage metrics — still needs your approval |
| **Skill adoption** | Proposes new skills learned from repeated patterns — still needs your approval |

Each toggle is a feature flag only — it does not delete data. Changing one needs the **update Autonomy** permission.

## Dashboard surfaces

| Surface | Meaning |
|---------|---------|
| Home setup item **Autonomy & self-improvement** | Opt-in explanation + link to the settings card |
| Home **Attention** | Pending approval items and stuck resumes |
| Conversation **Waiting approval** | Run blocked on you |
| Telegram **Approve / Deny** | Same decide path as this queue, for yellow/red tools. The ping goes to the thread's Telegram mapping, else an approved pairing. No raw tool arguments. See [Telegram](/docs/en/communication/telegram/#approval-ping) |

## Related

- [Home](/docs/en/daily/home/)
- [Forge](/docs/en/agents/forge/)
- [Proactive assistant](/docs/en/automation/proactive/)
- [Security & privacy](/docs/en/admin/security-privacy/)
- [Telegram](/docs/en/communication/telegram/)
