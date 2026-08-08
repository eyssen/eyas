---
title: Dashboard
description: Home screen — attention, running work, setup recommendations, briefing, schedule.
---

**Route:** `/` (nav: **Home**).  
Subtitle: *What needs you — and what is running now.*

## Sections

### Stats strip

| Label | Meaning |
|-------|---------|
| **Needs you** | Items that require a human (approvals, stuck runs, overdue, …) |
| **Running** | Agents / runs currently executing |
| **Waiting** | Blocked on reply or approval |
| **Cost today** | Estimated model spend for the day (when cost tracking is available) |

### Autonomy nudge

| Control | Meaning |
|---------|---------|
| Title / body | Explains opt-in self-improvement loops (off by default) |
| **Review autonomy settings** | Opens Autonomy settings |
| **Dismiss** | Hide this nudge |

### Recommended setup

Checklist of remaining onboarding. Completed items disappear; optional ones can wait.

| Control | Meaning |
|---------|---------|
| **Set up** | Navigate to the related settings screen |
| **Hide this recommendation** | Dismiss one item |
| **Hide all recommendations** | Dismiss the whole card |
| **Optional** badge | Not required for basic use |
| Progress text | How many left / done / hidden |

#### Recommendation items

| Item | What to configure |
|------|-------------------|
| **AI models & providers** | At least one provider + enabled models |
| **Projects** | Project for work/home/clients |
| **Base prompts & personality** | Master prompt / personas |
| **Agents & team** | Enable/customize assistants |
| **Primary agent communication** | Bind a channel (Telegram, …) to the primary agent |
| **Directories to index** | Search sources for code/docs |
| **Memory vault** | Seed vault notes |
| **Backups** | First backup (and later schedule) |
| **Remote access (Ingress)** | Optional tunnel |
| **Autonomy & self-improvement** | Optional background loops |

### Needs attention

| Kind | Meaning |
|------|---------|
| **Approval** | Security / autonomy approval pending |
| **Stuck resume** | Run needs resume |
| **Agent waiting** | Agent blocked on input |
| **Overdue** | Past due work |
| **Due today** | Due today |
| **Alert** | Proactive alert |

Empty state: *Nothing waiting on you right now.*

### Pinned

Conversations pinned from the Board. **Unpin** removes the pin (does not delete the conversation).

### Recent

Latest conversations (title or *Untitled conversation*). **Open** navigates into the thread.

### Now running

Live agent activity (Mission Control data). Statuses: Running, Waiting for approval, Paused, Idle, Working, Error, …

### Morning briefing

Filled when memory reflections / briefing generation is enabled. Empty until then.

### Next up

Upcoming scheduler jobs. Shows relative times (*in 5m*, *2h ago*, …).

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Board](/docs/en/daily/board/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Setup wizard](/docs/en/setup-wizard/)
