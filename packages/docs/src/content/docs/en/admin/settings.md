---
title: Settings overview
description: System hub — appearance, language, cards, links.
---

**What this is for.** Settings (`/settings`) is the system hub: appearance, language, model assignments, God Mode roster, and the sidebar groups that open every other admin surface. Stats and system info live on this page. [Notifications](/docs/en/admin/notifications/), [Extensions](/docs/en/admin/extensions/), [Remote nodes](/docs/en/admin/nodes/), and [Hands](/docs/en/admin/hands/) are their own pages, linked from the sidebar — they are not hosted here.

**Route:** `/settings`.

## Stats

Providers active/total · Models enabled/total · Secrets count · Users count.

## Providers summary

List of providers with active indicator and model counts (full config under Providers page).

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
| **System update** | Check/apply updates from GitHub |
| **Data port** | Import wizard ([Data import](/docs/en/admin/data-port/)) |
| **Appearance** | Theme template + light/dark |
| **Language** | en / hu / de / es / fr / tlh |
| **Model assignments** | Per-agent model picks |
| **God Mode** | Roster of 2–5 models that race the same task, plus chair, cost ceiling, and worker-folder retention. See [Conversations — God Mode](/docs/en/daily/conversations/#god-mode). |
| **Team agents** | Specialist selection |
| **Autonomy features** | Feature flags |

## Sidebar settings groups

| Group | Links |
|-------|-------|
| General | System, Users, API Keys, Secrets |
| AI & Model | Providers, Prompts, Memory, MCP |
| Modules | Projects, Documents, Search sources, [Notifications](/docs/en/admin/notifications/) (`/notifications-settings`), Proactive, Self-learning, [Extensions](/docs/en/admin/extensions/) (`/extensions`) |
| Integrations | [Connections](/docs/en/admin/connections/) (`/connections`) — external systems inventory |
| Infrastructure | [Hands](/docs/en/admin/hands/) (`/hands`), [Ingress](/docs/en/admin/ingress/), [Nodes](/docs/en/admin/nodes/) (`/nodes`), Backup, Meetings |

## Related

- [Providers](/docs/en/ai/providers/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Connections](/docs/en/admin/connections/)
- [Notifications](/docs/en/admin/notifications/)
- [Extensions](/docs/en/admin/extensions/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Hands](/docs/en/admin/hands/)
