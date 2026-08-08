---
title: Scheduler
description: Jobs, triggers, views, health — every field.
---

**Route:** `/scheduler`. Subtitle: *Recurring jobs, agent routines, and run history.*

## Views

| View | Meaning |
|------|---------|
| **List** | Job table |
| **Gantt** | Timeline bars |
| **Calendar** | Calendar layout |
| Zoom **Day / Week / Month** | Gantt/calendar scale |

## Create job

| Field | Meaning |
|-------|---------|
| **Job name** | Display name |
| **Handler** | System handler id (e.g. `backup.run`) or pick from list |
| **Trigger Type** | **Cron** · **Interval** · **Event** |
| **Schedule (cron)** | Cron expression when type=Cron |
| **Interval (ms)** | Period when type=Interval |
| **Event Name** | Bus event when type=Event (e.g. `conversation.completed`) |
| **Agent ID** | For agent routines |
| **Prompt** | Prompt text for agent_run jobs |
| **Create** | Persist job |

## Job kinds

| Kind | Meaning |
|------|---------|
| **System handler** | Built-in maintenance/automation handler |
| **Agent routine** | Runs an agent with a prompt on a schedule |

## Job row actions / stats

| Control | Meaning |
|---------|---------|
| **Paused / Running** | Job enabled state |
| **Last / Next** | Last and next fire times |
| **N runs / N fails** | Counters |
| **Run Now** | Fire immediately |
| **Pause / Resume** | Toggle |
| **Reschedule** + **Apply** | Change schedule |
| **Delete** | Remove job + history (confirm) |
| **Assigned Agent** | Agent name for routines |
| Search | Filter list |
| **Show infrastructure jobs** | Include internal infra jobs |

## Recent executions

List of past runs; empty: *No executions yet.*

## Health strip

| Metric | Meaning |
|--------|---------|
| **Leader / Follower** | Cluster leadership (multi-instance) |
| **N active** | Active jobs |
| **N running** | Currently executing |
| **N failed (24h)** | Failures last day |
| **N dead-letter** | Exhausted retries |
| **N overdue** | Missed schedule |

## Legend (timeline)

past · running · next · future · runs · due

## Related

- [CLI / config](/docs/en/deploy/configuration/)
- [Agents](/docs/en/agents/overview/)
