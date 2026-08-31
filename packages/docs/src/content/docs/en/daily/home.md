---
title: Home
description: Your landing grid — pulse, attention, running agents, schedule, and cost at a glance.
---

**What this is for.** Home is the first screen after login: a personal widget grid that shows what needs you, what is running, and what is coming up. Everyone starts on the same factory layout. You rearrange it when the default nine no longer match how you work.

## When to use it

- You want a single glance at approvals, stuck runs, and today's spend before you open a conversation.
- You need to pause or interrupt a running agent without hunting through Mission Control.
- You want today's schedule, including a job whose last run failed.
- You are still setting EYAS up — the recommended-setup strip walks the remaining basics.
- You want a board or a briefing on the same page as the pulse.

## Typical workflow

1. Open **Home** in the sidebar (**Main** section) — route `/`.
2. Read **Pulse** (needs you, running, waiting, cost today, failed jobs) and **Attention** (approvals, stuck resumes, overdue).
3. Click a figure to jump to its list, or **Edit home page** to rearrange, resize, add, or remove tiles.
4. Click **Done**. Changes save on their own. You should see your layout persist on the next visit.

## Features

Home replaced the old fixed dashboard with a grid of tiles you can rearrange, resize, add to, and
remove from. Everyone starts on the same **factory layout**; nothing is customised until you
change something.

## The factory nine

| Tile | Shows |
|------|-------|
| **Pulse** | Needs you, running, waiting, cost today, and failed jobs — each figure links to its list |
| **Attention** | Approvals, stuck resumes, agents waiting, overdue and due-today items, proactive alerts — approve, reject, retry, or open from the tile |
| **Running agents** | Live agent activity — pause, resume, or interrupt |
| **Schedule** | Upcoming scheduler jobs, including one whose **last run failed** |
| **Conversations** | Your most recent conversations |
| **Board** | A board you choose (tile setting) — open a card from the tile |
| **Briefing** | Your morning briefing, once memory reflections are enabled |
| **Cost** | Spend for the current period against your configured budgets |
| **System** | Anomalies, failures in the last 24h, overdue and dead-letter jobs, unrunnable jobs |

If a tile's own module has a problem — a failed request, a disabled dependency — that tile alone
shows **Unavailable**. The rest of the page keeps working.

## Recommended setup

A fixed strip above the grid, not a tile: it walks you through the basics (providers, projects,
prompts, agents, a communication channel, search sources, memory, backups, remote access,
autonomy) and disappears once there is nothing left to do. You can hide one recommendation or all
of them; it is never part of the grid, so you cannot accidentally remove it while customising your
layout.

## Editing the grid

Click **Edit home page** in the header. While editing:

- **Move a tile** — drag it by the handle in its header.
- **Resize a tile** — drag its corner handle.
- **Remove a tile** — click the **×** in its header.
- **Add a tile** — a drawer opens on the right listing every widget the system knows about,
  including ones from disabled modules (shown dimmed, so you can see what could be there). Click
  an available entry to add it; it lands at the bottom of your layout, ready to be dragged into
  place.

Click **Done** to leave edit mode. Changes save automatically a moment after you stop dragging —
there is no separate save button.

**Restore factory layout** (visible while editing) throws away your customisation for the current
breakpoint and reverts to the factory nine. It only affects the layout you are currently viewing —
your phone-width and tablet-width layouts (if you have arranged them separately) are untouched.

## New widgets are offered, not inserted

Once you have customised your layout, a future release that adds a factory widget will **not**
silently drop it into your grid. Instead a bar appears above the grid: *"New widgets available" —
**Add** or **No thanks**.** **Add** appends the new tiles below your existing ones; **No thanks**
dismisses the offer for good. A layout you deliberately arranged never rearranges itself behind
your back.

If you have never customised your layout, this does not apply to you — you are always on the
current factory layout, new tiles included, automatically.

## Board tile configuration

The Board tile needs a project before it can show anything. Configure it from the tile itself; you
can place the Board tile more than once with a different project in each.

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Board](/docs/en/daily/board/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Setup wizard](/docs/en/setup-wizard/)
