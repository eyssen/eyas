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

An invalid cron expression or an interval under one second is rejected when you press **Create**, with the reason shown on the form: *"That schedule is not valid, so the job would never run. Check the cron expression or the interval."* Previously such a job was created and silently never ran. An **Event** trigger is still accepted, but such a job cannot fire on its own yet — it is created with the **Never fires** badge (see below).

## Job kinds

| Kind | Meaning |
|------|---------|
| **System handler** | Built-in maintenance/automation handler |
| **Agent routine** | Runs an agent with a prompt on a schedule |

## Job row actions / stats

| Control | Meaning |
|---------|---------|
| **Paused / Running** | Job enabled state |
| **Cannot-run badge** | Shown on the row as **No handler**, **Never fires**, or **Not scheduled** — no handler registered (its module is probably disabled), a trigger type that never fires on its own (Event), or a schedule that could not be armed (invalid cron, or interval under one second). Hover for the cause. |
| **Last / Next** | Last and next fire times |
| **N runs / N fails** | Counters |
| **Run Now** | Fire immediately; disabled only when the job has no registered handler, or is disabled/dead-letter, with the reason in the tooltip. A job badged **Never fires** or **Not scheduled** can still be run this way — for an Event job it is the only way it ever runs |
| **Pause / Resume** | Toggle |
| **Reschedule** + **Apply** | Change schedule; an invalid cron expression or a sub-second interval is rejected and the reason appears under the field |
| **Delete** | Remove job + history (confirm) |
| **Assigned Agent** | Agent name for routines |
| Search | Filter list |
| **Show infrastructure jobs** | Include internal infra jobs |

**Show infrastructure jobs** never hides a job that cannot run — a broken system job stays visible even with the filter off.

## Recent executions

List of past runs — start time, duration, and who triggered each one (`system` when a timer fired it, an agent, or a user id); empty: *No executions yet.*

## Health strip

| Metric | Meaning |
|--------|---------|
| **Leader / Follower** | Cluster leadership (multi-instance) |
| **N active** | Active jobs |
| **N running** | Currently executing |
| **N failed (24h)** | Failures last day |
| **N dead-letter** | Exhausted retries |
| **N overdue** | Missed schedule |
| **N cannot run** | Jobs that will not execute as configured |

## Legend (timeline)

past · running · next · future · runs · due

## Related

- [CLI / config](/docs/en/deploy/configuration/)
- [Agents](/docs/en/agents/overview/)
