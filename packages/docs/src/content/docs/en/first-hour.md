---
title: Your first hour
description: A guided first hour in the running UI — Home, one conversation, a board card, and where memory lives.
---

**What this is for.** Install and the [setup wizard](/docs/en/setup-wizard/) are done. This hour is a walk through the live product so you know where work starts, where it is tracked, and how facts stick. It is not a field list.

## When to use it

- You can sign in and the main app is open
- You want one useful conversation, not a tour of every screen
- You need to see how **Home**, **Board**, **Memory**, and **Agents** fit together

## Sign in and land on Home

Open the UI (default **http://localhost:3100**). Enter the root owner **Username** and **Password** you created in the wizard, then click **Sign in**.

You land on **Home** (`/`). Everyone starts on the same factory grid until you customise it.

Look at three tiles first:

- **Pulse** — needs you, running, waiting, cost today, failed jobs
- **Attention** — approvals, stuck work, agents waiting, overdue items; you can act from the tile
- **Running agents** — live activity; **Pause**, **Resume**, or **Stop**

A recommended-setup strip may sit above the grid until leftover optional work is done. Ignore it for this hour.

## Start a conversation

In the sidebar, click **New Conversation**. The empty state says **Start a conversation…**.

Type a request that is actually useful — how you want to be worked with, a decision, or a task you want tracked. Use the composer: **Type a message… (Shift+Enter for newline)**. Send it.

Watch the stream: **Thinking** or **Thinking…**, then **Composing response…** or **Running tools…**. Tool rows show the tool id, a short argument preview, and the result while they run — file edits open a **Diff**. **Stop** cancels the run. The map icon on the composer is **Plan first** if you want a plan before tools.

Keep the thread open. You will put it on the board next.

## Put it on the Board

Open **Board** in the sidebar (`/board`). Conversations are cards. Yours is often already there, titled from the thread (or **Untitled**).

- Pin it so it stays on the pin strip (**Pinned**).
- Or click **New**, type a **Conversation title…**, and create a card linked to a thread.

You now have a place to talk and a place to track the same work.

## See where memory lives

Open **Memory** (`/memory`). Start on **Overview**, then open **Vault Files**.

From 0.8.16-beta, a durable fact you state in any conversation can become a vault note **without you asking**. Capture is global and on by default. It runs after the reply is delivered — never in the critical path of the answer. Short turns and small talk usually produce nothing; that is correct.

You may not see a new file in the first minute. Come back to **Vault Files** after a longer, fact-dense exchange, or write a note by hand. Agents can still save memory on purpose.

## Meet your primary agents

Open **Agents** (`/agents`). Filter **Primary**. These are the two teammates you named in the wizard: the **Personal Assistant** (day-to-day) and the **System Engineer** (EYAS itself). They stay; conversations come and go.

You do not need to create more agents this hour.

## What to learn next

- [Conversations](/docs/en/daily/conversations/) — composer, rails, effort, orchestration
- [Board](/docs/en/daily/board/) — cards, stages, views
- [Agents overview](/docs/en/agents/overview/) — tiers, types, list
- [Memory](/docs/en/knowledge/memory/) — five tiers and vault notes
- [Skills](/docs/en/automation/skills/) — reusable procedures agents can load
- [Tools](/docs/en/automation/tools/) — the live catalogue; search `browser_` for headless Playwright
- [Browser Use](/docs/en/automation/browser-use/) — public pages vs logged-in Chrome vs Hands
- [Core concepts](/docs/en/concepts/) — the mental model, once you have clicked around
