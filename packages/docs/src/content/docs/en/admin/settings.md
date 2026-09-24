---
title: Settings overview
description: System hub — appearance, language, cards, links.
---

**What this is for.** The **System** page (`/settings`) is the settings hub: stats, system info, appearance and language, model assignments, the God Mode roster, and the sidebar groups that open every other admin surface. [Notifications](/docs/en/admin/notifications/), [Extensions](/docs/en/admin/extensions/), [Remote nodes](/docs/en/admin/nodes/), and [Hands](/docs/en/admin/hands/) are their own pages, linked from the sidebar — they are not hosted here.

**Route:** `/settings` (sidebar **System**).

## Stats

**Providers** (active / total) · **Models** (enabled / total) · **Secrets** (encrypted) · **Users** (registered).

## Providers summary

The list of providers with an active indicator and the enabled / total model count. Provider names are the same product names as on the Providers page (full configuration there).

## System info

| Field | Meaning |
|-------|---------|
| **Version** | EYAS version |
| **Status** | Health |
| **Runtime** | Bun |
| **Database** | SQLite (WAL) |

## Cards on this page

| Card | Purpose |
|------|---------|
| **Updates** | Check and apply updates from GitHub |
| **Data portability** | Import wizard ([Data import](/docs/en/admin/data-port/)) |
| **Appearance** | **Theme** (light/dark), **Language** (en / hu / de / es / fr / tlh) and **Template** |
| **Model Assignments** | Per-agent picks, each shown and saved as *Provider / model*, so a model id that two providers list is never ambiguous. See [Routing & budget — Model assignments](/docs/en/ai/routing-budget/#model-assignments). The setup wizard's AI Models step follows the same rules |
| **God Mode** | Roster of 2–5 models that race the same task, plus chair, cost ceiling, and worker-folder retention. See [Conversations — God Mode](/docs/en/daily/conversations/#god-mode). |
| **Team Agents** | Specialist selection |
| **Autonomy & self-improvement** | The background self-improvement loops, all off by default — see [Autonomy](/docs/en/agents/autonomy/) |

## Sidebar settings groups

| Group | Links |
|-------|-------|
| **General** | System, Users, API Keys, Secrets, [Connections](/docs/en/admin/connections/) (`/connections`) |
| **AI & Model** | Providers, Media, Prompts, Memory, MCP Servers |
| **Modules** | Projects, Documents, Search Sources, [Notifications](/docs/en/admin/notifications/) (`/notifications-settings`), Proactive, Self-Learning, [Extensions](/docs/en/admin/extensions/) (`/extensions`) |
| **Infrastructure** | [Hands](/docs/en/admin/hands/) (`/hands`), [Ingress](/docs/en/admin/ingress/), [Nodes](/docs/en/admin/nodes/) (`/nodes`), Backup, Meetings |

## Related

- [Providers](/docs/en/ai/providers/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Connections](/docs/en/admin/connections/)
- [Notifications](/docs/en/admin/notifications/)
- [Extensions](/docs/en/admin/extensions/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Hands](/docs/en/admin/hands/)
